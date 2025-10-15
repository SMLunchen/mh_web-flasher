import { mande } from 'mande';
import { defineStore } from 'pinia';
import {
  vendorCobrandingTag,
} from '~/types/resources';

import { MeshDevice } from '@meshtastic/core';
import { TransportWebSerial } from '@meshtastic/transport-web-serial';

import { type DeviceHardware } from '../types/api';
import { createUrl } from './store';
import { useFirmwareStore } from './firmwareStore';
import { useToastStore } from './toastStore';

// ===== KONFIGURATION =====
const USE_CUSTOM_HARDWARE_LIST = false; // true für eigene Hardware-Liste
const CUSTOM_HARDWARE_JSON_PATH = 'https://flasher.schwarzes-seelenreich.de/backend/data/custom-hardware-list.json';

// Eigene Hardware-Liste - Alternative zu JSON
const CUSTOM_HARDWARE_LIST: DeviceHardware[] = [
  // Beispiele - könnt ihr anpassen
  {
    hwModel: 1,
    hwModelSlug: "TLORA_V2",
    platformioTarget: "tlora-v2",
    architecture: "esp32",
    activelySupported: true,
    displayName: "TTGO LoRa V2",
    tags: ["esp32", "custom"],
    supportLevel: 1,
    images: [],
    hasMui: false
  },
  {
    hwModel: 2,
    hwModelSlug: "TBEAM",
    platformioTarget: "tbeam",
    architecture: "esp32",
    activelySupported: true,
    displayName: "TTGO T-Beam",
    tags: ["esp32", "custom"],
    supportLevel: 1,
    images: [],
    hasMui: false
  }
];

declare global {
  interface Navigator {
    serial: any;
  }
  interface SerialPort {
    readable: ReadableStream;
    writable: WritableStream;
    open(options: any): Promise<void>;
    close(): Promise<void>;
    forget(): Promise<void>;
  }
}

const firmwareApi = mande(createUrl("api/resource/deviceHardware"));

export const useDeviceStore = defineStore("device", {
  state: () => {
    return {
      selectedDevice: <DeviceHardware | undefined>undefined,
      selectedTarget: <DeviceHardware | undefined>undefined,
      tag: <string | undefined>undefined,
      targets: <DeviceHardware[]>[],
      isConnecting: false,
      abortController: <AbortController | undefined>undefined,
      readerClosed: <Promise<any> | undefined>undefined,
      writerClosed: <Promise<any> | undefined>undefined,
      port: <SerialPort | undefined>undefined,
    };
  },
  getters: {
    filteredDevices(): DeviceHardware[] {
      if (this.tag) {
        return this.targets.filter(t => t.tags?.includes(this.tag ?? '') || t.architecture === this.tag);
      }
      return this.targets
    },
    sortedDevices(): DeviceHardware[] {
      return this.filteredDevices
        .filter(t => t.supportLevel === 1).sort((a, b) => {
            const hwModelComparison = a.hwModel - b.hwModel;
            if (hwModelComparison !== 0) return hwModelComparison;
            return (a.images?.length ?? 0) - (b.images?.length ?? 0);
          })
        .concat(this.filteredDevices.filter(t => t.supportLevel === 2)
          .sort((a, b) => {
            const hwModelComparison = a.hwModel - b.hwModel;
            if (hwModelComparison !== 0) return hwModelComparison;
            return (a.images?.length ?? 0) - (b.images?.length ?? 0);
          }))
        .concat(this.filteredDevices.filter(t => (t.supportLevel ?? 3) === 3)
          .sort((a, b) => a.hwModel - b.hwModel));
    },
    allTags(): string[] {
      return this.targets.flatMap(t => t.tags ?? []).filter((v, i, a) => a.indexOf(v) === i);
    },
    allArchs(): string[] {
      return this.targets.map(t => t.architecture).filter((v, i, a) => a.indexOf(v) === i);
    },
    selectedArchitecture: (state) => state.selectedTarget?.architecture || "",
    isSelectedNrf(): boolean {
      return this.selectedArchitecture.startsWith("nrf52");
    },
    isSoftDevice7point3(): boolean {
      const sd73Devices = ["WIO_WM1110", "TRACKER_T1000_E", "XIAO_NRF52_KIT", "SEEED_SOLAR_NODE", "SEEED_WIO_TRACKER_L1" , "SEEED_WIO_TRACKER_L1_EINK"];
      return sd73Devices.includes(this.selectedTarget?.hwModelSlug || '');
    },
    enterDfuVersion(): string {
      if (this.isSelectedNrf) {
        return "2.2.17";
      }
      return "2.2.18";
    },
    dfuStepAction(): string {
      const { t } = useI18n();

      if (this.isSelectedNrf) {
        return t('flash.dfu_action_doubleclick');
      }
      return t('flash.dfu_action_bootsel');
    },
  },
  actions: {
    async fetchList() {
      try {
        // Option 1: Hart-codierte eigene Liste
        if (USE_CUSTOM_HARDWARE_LIST) {
          console.log('Using custom hardcoded hardware list');
          this.setTargetsList(CUSTOM_HARDWARE_LIST);
          return;
        }

        // Option 2: Lade eigene Liste aus JSON
        try {
          console.log('Attempting to load custom hardware list from JSON');
          const response = await fetch(CUSTOM_HARDWARE_JSON_PATH);
          if (response.ok) {
            const customHardwareList = await response.json();
            this.setTargetsList(customHardwareList);
            console.log('Successfully loaded custom hardware list from JSON');
            return;
          }
        } catch (jsonError) {
          console.warn('Could not load custom hardware JSON, falling back to API:', jsonError);
        }

        // Option 3: Fallback zur Meshtastic API
        console.log('Falling back to Meshtastic API');
        const targets = await firmwareApi.get<DeviceHardware[]>();
        this.setTargetsList(targets);
      } catch (ex) {
        console.error('Error fetching hardware list from API:', ex);
        
        // Final Fallback: Original offline list
        try {
          const response = await fetch('/data/hardware-list.json');
          if (response.ok) {
            const offlineHardwareList = await response.json();
            this.setTargetsList(offlineHardwareList);
          } else {
            console.error('Failed to load hardware list from JSON file');
          }
        } catch (error) {
          console.error('Error loading hardware list from JSON file:', error);
        }
      }
    },
    setTargetsList(targets: DeviceHardware[]) {
      if (vendorCobrandingTag.length > 0) {
        this.targets = targets.filter(
          (t: DeviceHardware) => t.activelySupported && t.tags?.includes(vendorCobrandingTag)
        );
      }
      else {
        this.targets = targets.filter(
          (t: DeviceHardware) => t.activelySupported
        );
      }
    },
    async setSelectedTarget(target: DeviceHardware) {
      this.selectedTarget = target;
      document.getElementById('device-modal')?.click();
      const firmwareStore = useFirmwareStore();

      // Gerät im firmwareStore setzen für gerätespezifische Firmware
      firmwareStore.setCurrentDevice(target.hwModelSlug || target.platformioTarget);

      await new Promise((_) => setTimeout(_, 250));
      
      // Prüfe ob gerätespezifische Firmware vorhanden ist
      if (firmwareStore.deviceSpecificFirmware.length > 0) {
        firmwareStore.setSelectedFirmware(firmwareStore.deviceSpecificFirmware[0]);
      } else if (!firmwareStore.hasFirmwareFile && !firmwareStore.hasOnlineFirmware && firmwareStore.stable.length > 0) {
        firmwareStore.setSelectedFirmware(firmwareStore.stable[0]);
      }

      // Auto-select MUI für Geräte die es unterstützen
      if (target.hasMui === true) {
        firmwareStore.$state.shouldInstallMui = true;
      }
      
      // Nur Console-Log - KEIN externes Tracking
      console.log('Selected target:', {
        hwModel: target.hwModel,
        hwModelSlug: target.hwModelSlug,
        platformioTarget: target.platformioTarget,
        architecture: target.architecture
      });
    },
    setSelectedTag(tag: string) {
      if (tag === "all") {
        this.tag = undefined;
        return;
      }
      if (tag === this.tag) {
        this.tag = undefined;
      } else {
        this.tag = tag;
      }
    },
    async openDeviceConnection(shouldConfigure: boolean = true): Promise<MeshDevice> {
      this.port = await navigator.serial.requestPort();
      const transport = await TransportWebSerial.createFromPort(this.port!, 115200);
      const id = Math.floor(Math.random() * 1e9);
      const device = new MeshDevice(transport, id);

      if (shouldConfigure) {
        await device.configure();
      }

      return device;
    },
    async cleanupDevice(device: MeshDevice) {
      console.log('Starting device cleanup...');

      if (this.port && device?.transport?.fromDevice) {
        try {
          await device.transport.fromDevice.cancel();
          } catch (error) {
            console.warn('Error cancelling fromDevice reader:', error);
          }
          try {
            await device.transport.toDevice.close();
          } catch (error) {
            console.warn('Error closing toDevice writer:', error);
          }
          try {
            const reader = device.transport.fromDevice.getReader();
            
            const textEncoder = new TextEncoderStream();
            const writer = textEncoder.writable.getWriter();
            const writableStreamClosed = textEncoder.readable.pipeTo(this.port.writable!);
            
            await reader.cancel();
            
            await writer.close();
            await writableStreamClosed;
            
            await this.port?.forget();
            
          } catch (error: any) {
            console.log('Disconnect failed:', error?.message || error);
            if (this.port) {
              await this.port.forget();
            }
          }
        } 
        
      this.abortController = undefined;
      this.readerClosed = undefined;
      this.writerClosed = undefined;
    },
    async enterDfuMode(tFunc?: (key: string) => string) {
      const toastStore = useToastStore();
      let device: MeshDevice | null = null;
      
      this.isConnecting = true;
      try {
        const connectionPromise = this.openDeviceConnection(false);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000)
        );
        let device: MeshDevice;
        try {
          device = await Promise.race([connectionPromise, timeoutPromise]);
        } catch (error) {
          if ((error as Error).message === 'timeout') {
            const errorTitle = tFunc?.('dfu.error_connection_title') || 'Device Connection Failed';
            const errorMessage = tFunc?.('dfu.error_connection') || 'Failed to connect to device. Please disconnect and reconnect the device, then try again. If the problem persists, reload the page.';
            toastStore.error(errorTitle, errorMessage);
            throw error;
          } else {
            throw error;
          }
        }
        device.events.onMyNodeInfo.subscribe((info) => {
          console.log("Received MyNodeInfo event:", info);
          device?.enterDfuMode();
        });
        try {
          await device.configure();
        } catch (error) {
          console.error('Error configuring device:', error);
          const errorTitle = tFunc?.('dfu.error_title') || 'DFU Mode Failed';
          const errorMessage = tFunc?.('dfu.error_message') || 'Failed to enter DFU mode. Please disconnect and reconnect the device, then try again.';
          toastStore.error(errorTitle, errorMessage);
          throw error;
        }
        await device.enterDfuMode();

        const successTitle = tFunc?.('dfu.success_title') || 'DFU Mode';
        const successMessage = tFunc?.('dfu.success_message') || 'Device successfully entered DFU mode';
        toastStore.success(successTitle, successMessage);

      } catch (error: any) {
        console.error('Error entering DFU mode:', error);
        
        const errorTitle = tFunc?.('dfu.error_connection_title') || 'Device Connection Failed';
        const errorMessage = tFunc?.('dfu.error_connection') || 'Failed to connect to device. Please disconnect and reconnect the device, then try again. If the problem persists, reload the page.';

        toastStore.error(errorTitle, errorMessage);
        throw error;
      } finally {
        if (device) {
          await this.cleanupDevice(device);
        }
        this.isConnecting = false;
      }
    },
    async baud1200() {
      this.port = await navigator.serial.requestPort();
      await this.port?.open({ baudRate: 1200 });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await this.port?.close();
    },
    async autoSelectHardware(tFunc?: (key: string) => string) {
      const toastStore = useToastStore();
      this.isConnecting = true;
      try {
        const connectionPromise = this.openDeviceConnection(false);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000)
        );
        let device: MeshDevice;
        try {
          device = await Promise.race([connectionPromise, timeoutPromise]);
        } catch (error) {
          if ((error as Error).message === 'timeout') {
            const errorTitle = tFunc?.('dfu.error_connection_title') || 'Device Connection Failed';
            const errorMessage = tFunc?.('dfu.error_connection') || 'Failed to connect to device. Please disconnect and reconnect the device, then try again. If the problem persists, reload the page.';
            toastStore.error(errorTitle, errorMessage);
            throw error;
          } else {
            throw error;
          }
        }
        device.events.onDeviceMetadataPacket.subscribe(async (packet: any) => {
          console.log("Received device metadata packet:", packet);
          let targetDevice: DeviceHardware | undefined = undefined;
          if (packet?.data?.platformioTarget?.length > 0) {
            targetDevice = this.targets.find(
              (target: DeviceHardware) => target.platformioTarget === packet?.data?.platformioTarget,
            );
          }
          if (!targetDevice) {
            targetDevice = this.targets.find(
              (target: DeviceHardware) => target.hwModel === packet?.data?.hwModel,
            );
          }
          if (targetDevice) {
            console.log("Found device onDeviceMetadataPacket", targetDevice);
            this.setSelectedTarget(targetDevice);
            if (targetDevice.architecture.startsWith('nrf')) {
              toastStore.success(
                  tFunc?.('dfu.success_title') || 'DFU Mode',
                  tFunc?.('dfu.success_message') || 'Device successfully entered DFU mode'
                );  
              await device?.enterDfuMode();
            }
            await this.cleanupDevice(device);
            
            return 0;
          }
        });
        
        const configurePromise = device.configure();
        try {
          await Promise.race([configurePromise, timeoutPromise]);
        } catch (error) {
          if ((error as Error).message === 'timeout') {
            if (this.selectedTarget) {
              await this.cleanupDevice(device);
              return;
            }
            const errorTitle = tFunc?.('dfu.error_unresponsive_title') || 'Device Unresponsive';
            const errorMessage = tFunc?.('dfu.error_unresponsive') || 'The device is not responding. Please ensure it is properly connected and not in DFU mode.';
            toastStore.error(errorTitle, errorMessage);
            throw error;
          } else {
            throw error;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 5000));
        await this.cleanupDevice(device);

        return -1;
      } catch (error) {
        console.error('Error in autoSelectHardware:', error);
        const errorTitle = tFunc?.('dfu.error_connection_title') || 'Device Connection Failed';
        const errorMessage = tFunc?.('dfu.error_connection') || 'Failed to connect to device. Please disconnect and reconnect the device, then try again. If the problem persists, reload the page.';

        toastStore.error(errorTitle, errorMessage);
        throw error;
      } finally {
        this.isConnecting = false;
      }
    },
  },
});
