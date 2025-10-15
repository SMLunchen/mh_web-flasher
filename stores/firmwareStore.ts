import {
  ESPLoader,
  type FlashOptions,
  type LoaderOptions,
  Transport,
} from 'esptool-js';
import { saveAs } from 'file-saver';
import { mande } from 'mande';
import { defineStore } from 'pinia';
import type { Terminal } from 'xterm';
import { supportsNew8MBPartitionTable } from '~/utils/versionUtils';
import {
  currentPrerelease,
  showPrerelease,
} from '~/types/resources';

import { useSessionStorage } from '@vueuse/core';
import {
  BlobReader,
  BlobWriter,
  ZipReader,
} from '@zip.js/zip.js';

import {
  type DeviceHardware,
  type FirmwareReleases,
  type FirmwareResource,
  getCorsFriendyReleaseUrl,
} from '../types/api';
import { createUrl } from './store';

// ===== KONFIGURATION =====
const USE_CUSTOM_FIRMWARE = true; // Auf true für eigene Firmware
const DEVICE_FIRMWARE_MAPPING_PATH = 'https://flasher.schwarzes-seelenreich.de/backend/data/device-firmware-mapping.json';

// Gerätespezifische Firmware - Alternative zu JSON
const DEVICE_SPECIFIC_FIRMWARE: Record<string, FirmwareResource[]> = {
  // Beispiel - könnt ihr anpassen oder komplett aus JSON laden
  'TLORA_V2': [],
  'TBEAM': [],
  'HELTEC_V3': [
  //{
   //   "id": "v2.7.0",
    //  "title": "Firmware 2.7.0 für Heltec",
     // "page_url": "https://flasher.schwarzes-seelenreich.de/backend/firmware/heltecv3/v2.7.0/",
  //    "created_at": "2024-01-15T00:00:00Z",
//      "bin_urls": {
  //      "update": "https://flasher.schwarzes-seelenreich.de/backend/firmware/heltec-v3/v2.7.0/firmware-heltecv3-2.7.0-update.bin",
    //    "factory": "https://flasher.schwarzes-seelenreich.de/backend/firmware/heltec-v3/v2.7.0/firmware-heltecv3-2.7.0.factory.bin",
      //  "ota": "https://flasher.schwarzes-seelenreich.de/backend/firmware/heltec-v3/v2.7.0/firmware-heltecv3-2.7.0-ota.bin",
    //    "littlefs": "https://flasher.schwarzes-seelenreich.de/backend/firmware/tbeam/v2.7.0/littlefs-2.7.0.bin"
    //  }
   // }

  ]
};

const previews = showPrerelease ? [currentPrerelease] : [];
const firmwareApi = mande(createUrl('api/github/firmware/list'))

export const useFirmwareStore = defineStore('firmware', {
  state: () => {
    return {
      stable: new Array<FirmwareResource>(),
      alpha: new Array<FirmwareResource>(),
      previews: previews,
      pullRequests: new Array<FirmwareResource>(),
      selectedFirmware: <FirmwareResource | undefined>{},
      selectedFile: <File | undefined>{},
      baudRate: 115200,
      hasSeenReleaseNotes: false,
      shouldCleanInstall: false,
      shouldBundleWebUI: false,
      shouldInstallMui: false,
      shouldInstallInkHud: false,
      partitionScheme: <String | undefined>{},
      flashPercentDone: 0,
      isFlashing: false,
      flashingIndex: 0,
      isReaderLocked: false,
      isConnected: false,
      port: <SerialPort | undefined>{},
      couldntFetchFirmwareApi: false,
      prereleaseUnlocked: useSessionStorage('prereleaseUnlocked', false),
      currentDeviceSlug: <string | undefined>undefined,
      deviceFirmwareMapping: <Record<string, FirmwareResource[]>>{},
    }
  },
  getters: {
    hasOnlineFirmware: (state) => (state.selectedFirmware?.id || '').length > 0,
    hasFirmwareFile: (state) => (state.selectedFile?.name || '').length > 0,
    percentDone: (state) => `${state.flashPercentDone}%`,
    firmwareVersion: (state) => state.selectedFirmware?.id ? state.selectedFirmware.id.replace('v', '') : '.+',
    canShowFlash: (state) => state.selectedFirmware?.id ? state.hasSeenReleaseNotes : true, 
    isZipFile: (state) => state.selectedFile?.name.endsWith('.zip'),
    isFactoryBin: (state) => state.selectedFile?.name.endsWith('.factory.bin'),
    deviceSpecificFirmware: (state) => {
      if (!state.currentDeviceSlug) return [];
      return state.deviceFirmwareMapping[state.currentDeviceSlug] || 
             DEVICE_SPECIFIC_FIRMWARE[state.currentDeviceSlug] || [];
    },
  },
  actions: {
    clearState() {
      this.shouldCleanInstall = false;
      this.shouldBundleWebUI = false;
      this.shouldInstallMui = false;
      this.shouldInstallInkHud = false;
      this.partitionScheme = undefined;
    },
    continueToFlash() {
      this.hasSeenReleaseNotes = true
    },
    setCurrentDevice(deviceSlug: string) {
      this.currentDeviceSlug = deviceSlug;
      
      if (Object.keys(this.deviceFirmwareMapping).length === 0) {
        this.loadDeviceFirmwareMapping();
      }
      
      const deviceFirmware = this.deviceFirmwareMapping[deviceSlug] || 
                             DEVICE_SPECIFIC_FIRMWARE[deviceSlug] || [];
      
      if (USE_CUSTOM_FIRMWARE && deviceFirmware.length > 0) {
        console.log(`Loading ${deviceFirmware.length} firmware versions for ${deviceSlug}`);
        this.stable = deviceFirmware;
        this.alpha = [];
        this.previews = [];
        this.pullRequests = [];
      } else {
        this.fetchList();
      }
    },
    async loadDeviceFirmwareMapping() {
      try {
        const response = await fetch(DEVICE_FIRMWARE_MAPPING_PATH);
        if (response.ok) {
          this.deviceFirmwareMapping = await response.json();
          console.log('Successfully loaded device firmware mapping');
        }
      } catch (error) {
        console.warn('Could not load device firmware mapping:', error);
        this.deviceFirmwareMapping = DEVICE_SPECIFIC_FIRMWARE;
      }
    },
    async fetchList() {
      if (USE_CUSTOM_FIRMWARE && this.currentDeviceSlug && this.deviceSpecificFirmware.length > 0) {
        console.log('Using device-specific firmware, skipping fetchList');
        return;
      }

      try {
        if (USE_CUSTOM_FIRMWARE) {
          try {
            console.log('Attempting to load custom firmware list from JSON');
            const response = await fetch(DEVICE_FIRMWARE_MAPPING_PATH);
            if (response.ok) {
              const customFirmware = await response.json();
              this.deviceFirmwareMapping = customFirmware;
              console.log('Successfully loaded custom firmware list');
              return;
            }
          } catch (jsonError) {
            console.warn('Could not load custom firmware JSON, falling back to API:', jsonError);
          }
        }

        console.log('Fetching firmware from Meshtastic API');
        const response = await firmwareApi.get<FirmwareReleases>();
        this.stable = response.releases.stable.slice(0, 4);
        this.alpha = response.releases.alpha.filter(f => !f.title.includes('Preview')).slice(0, 4);
        this.previews = [
          ...response.releases.alpha
            .filter(f => f.title.includes('Preview') && !f.title.includes('2.6.0'))
            .slice(0, 4),
          ...previews
        ];
        this.pullRequests = response.pullRequests.slice(0, 4);
      } catch (error) {
        console.error('Error fetching firmware list:', error);
        this.couldntFetchFirmwareApi = true;
      }
    },
    async setSelectedFirmware(firmware: FirmwareResource) {
      this.selectedFirmware = firmware;
      this.selectedFile = undefined;
      this.hasSeenReleaseNotes = false;
      const currentMuiSetting = this.shouldInstallMui;
      this.clearState();
      this.shouldInstallMui = currentMuiSetting;
      
      // Nur Console-Log, KEIN Tracking
      console.log('Selected firmware:', firmware.id);
    },
    getReleaseFileUrl(fileName: string): string {
      // Prüfe zuerst ob direkte BIN-URLs vorhanden sind
      if (this.selectedFirmware?.bin_urls) {
        if (fileName.includes('update.bin') && this.selectedFirmware.bin_urls.update) {
          return this.selectedFirmware.bin_urls.update;
        }
        if (fileName.includes('factory.bin') && this.selectedFirmware.bin_urls.factory) {
          return this.selectedFirmware.bin_urls.factory;
        }
        if (fileName.includes('ota.bin') && this.selectedFirmware.bin_urls.ota) {
          return this.selectedFirmware.bin_urls.ota;
        }
        if (fileName.includes('littlefs') && this.selectedFirmware.bin_urls.littlefs) {
          return this.selectedFirmware.bin_urls.littlefs;
        }
      }
      
      // Fallback zu ZIP
      if (!this.selectedFirmware?.zip_url) return '';
      const baseUrl = getCorsFriendyReleaseUrl(this.selectedFirmware.zip_url);
      return `${baseUrl}/${fileName}`;
    },
    async downloadUf2FileSystem(searchRegex: RegExp) {
      // Prüfe ob direkte UF2-URL vorhanden ist
      if (this.selectedFirmware?.uf2_urls) {
        const uf2Url = this.selectedFirmware.uf2_urls.update || this.selectedFirmware.uf2_urls.full;
        if (uf2Url) {
          console.log(`Downloading UF2 from: ${uf2Url}`);
          const response = await fetch(uf2Url);
          const blob = await response.blob();
          const fileName = uf2Url.split('/').pop() || 'firmware.uf2';
          saveAs(blob, fileName);
          return;
        }
      }
      
      if (!this.selectedFile) return;
      const reader = new BlobReader(this.selectedFile);
      const zipReader = new ZipReader(reader);
      const entries = await zipReader.getEntries()
      console.log('Zip entries:', entries);
      const file = entries.find(entry => searchRegex.test(entry.filename))
      if (file) {
        if (file?.getData) {
          const data = await file.getData(new BlobWriter());
          saveAs(data, file.filename);
        } else {
          throw new Error(`Could not find file with pattern ${searchRegex} in zip`);
        }
      }
      else {
        throw new Error(`Could not find file with pattern ${searchRegex} in zip`);
      }
      zipReader.close();
    },
    async setFirmwareFile(file: File) {
      this.selectedFile = file;
      this.selectedFirmware = undefined;
      const currentMuiSetting = this.shouldInstallMui;
      this.clearState();
      this.shouldInstallMui = currentMuiSetting;
    },
    async updateEspFlash(fileName: string, selectedTarget: DeviceHardware) {
      const terminal = await openTerminal();

      try {
        this.port = await navigator.serial.requestPort({});
        this.isConnected = true;
        this.port.ondisconnect = () => {
          this.isConnected = false;
        };
        const transport = new Transport(this.port, true);
        const espLoader = await this.connectEsp32(transport, terminal);
        const content = await this.fetchBinaryContent(fileName);
        this.isFlashing = true;
        const flashOptions: FlashOptions = {
          fileArray: [{ data: content, address: 0x10000 }],
          flashSize: 'keep',
          eraseAll: false,
          compress: true,
          flashMode: 'keep',
          flashFreq: 'keep',
          reportProgress: (fileIndex, written, total) => {
            this.flashPercentDone = Math.round((written / total) * 100);
            if (written === total) {
              this.isFlashing = false;
              console.log('Done flashing!');
              this.logFlash(selectedTarget, false); // Nur Logging
            }
          },
        };
        await this.startWrite(terminal, espLoader, transport, flashOptions);
      }
      catch (error: any) {
        this.handleError(error, terminal);
      }
    },
    handleError(error: Error, terminal: Terminal) {
      console.error('Error flashing:', error);
      terminal.writeln('');
      terminal.writeln(`\x1b[38;5;9m${error}\x1b[0m`);
    },
    async startWrite(terminal: Terminal, espLoader: ESPLoader, transport: Transport, flashOptions: FlashOptions) {
      await espLoader.writeFlash(flashOptions);
      await this.resetEsp32(transport);
      if (this.port) {
        await this.readSerial(this.port, terminal);
      } else {
        throw new Error('Serial port is not defined');
      }
    },
    async resetEsp32(transport: Transport) {
      await transport.setRTS(true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await transport.setRTS(false);
    },
    // KOMPLETT NEUES logFlash - KEIN externes Tracking, nur Console
    logFlash(selectedTarget: DeviceHardware, isCleanInstall: boolean) { 
      const logData = {
        timestamp: new Date().toISOString(),
        hardware: selectedTarget.hwModelSlug || 'unknown',
        hwModel: selectedTarget.hwModel,
        platformioTarget: selectedTarget.platformioTarget,
        architecture: selectedTarget.architecture,
        firmware: this.selectedFirmware?.id || 'unknown',
        cleanInstall: isCleanInstall,
        partitionScheme: this.partitionScheme || 'default',
      };
      
      // Nur Console-Log - nginx/docker loggt das automatisch
      console.log('[FLASH]', JSON.stringify(logData));
    },
    async cleanInstallEspFlash(fileName: string, otaFileName: string, littleFsFileName: string, selectedTarget: DeviceHardware) {
      const terminal = await openTerminal();

      try {
        this.port = await navigator.serial.requestPort({});
        this.isConnected = true;
        this.port.ondisconnect = () => {
          this.isConnected = false;
        };
        const transport = new Transport(this.port, true);
        const espLoader = await this.connectEsp32(transport, terminal);
        const appContent = await this.fetchBinaryContent(fileName);
        const otaContent = await this.fetchBinaryContent(otaFileName);
        const littleFsContent = await this.fetchBinaryContent(littleFsFileName);

        let otaOffset = 0x260000;
        let spiffsOffset = 0x300000;
        
        if (this.partitionScheme == "8MB") {
          const isTftDevice = selectedTarget.hasMui === true;
          const useNewPartitionTable = isTftDevice && supportsNew8MBPartitionTable(this.firmwareVersion);
          
          console.log(`8MB partition selection: TFT device: ${isTftDevice}, Firmware: ${this.firmwareVersion}, Use new table: ${useNewPartitionTable}`);
          
          if (useNewPartitionTable) {
            otaOffset = 0x5D0000;
            spiffsOffset = 0x670000;
            console.log(`Using new 8MB partition table: OTA at 0x${otaOffset.toString(16)}, SPIFFS at 0x${spiffsOffset.toString(16)}`);
          } else {
            otaOffset = 0x340000;
            spiffsOffset = 0x670000;
            console.log(`Using legacy 8MB partition table: OTA at 0x${otaOffset.toString(16)}, SPIFFS at 0x${spiffsOffset.toString(16)}`);
          }
        }
        else if (this.partitionScheme == "16MB") {
          otaOffset = 0x650000;
          spiffsOffset = 0xc90000;
        }

        this.isFlashing = true;
        const flashOptions: FlashOptions = {
          fileArray: [
            { data: appContent, address: 0x00 },
            { data: otaContent, address: otaOffset },
            { data: littleFsContent, address: spiffsOffset }
          ],
          flashSize: 'keep',
          eraseAll: true,
          compress: true,
          flashMode: 'keep',
          flashFreq: 'keep',
          reportProgress: (fileIndex, written, total) => {
            this.flashingIndex = fileIndex;
            this.flashPercentDone = Math.round((written / total) * 100);
            if (written === total && fileIndex > 1) {
              this.isFlashing = false;
              console.log('Done flashing!');
              this.logFlash(selectedTarget, true); // Nur Logging
            }
          },
        };
        await this.startWrite(terminal, espLoader, transport, flashOptions);
      } catch (error: any) {
        this.handleError(error, terminal);
      }
    },
    async fetchBinaryContent(fileName: string): Promise<string> {
      // Option 1: Direkte BIN-URL
      if (this.selectedFirmware?.bin_urls) {
        let binUrl: string | undefined;
        
        if (fileName.includes('update.bin')) {
          binUrl = this.selectedFirmware.bin_urls.update;
        } else if (fileName.includes('factory.bin') || fileName.includes('.factory.bin')) {
          binUrl = this.selectedFirmware.bin_urls.factory;
        } else if (fileName.includes('ota.bin') || fileName.includes('-ota.bin')) {
          binUrl = this.selectedFirmware.bin_urls.ota;
        } else if (fileName.includes('littlefs')) {
          binUrl = this.selectedFirmware.bin_urls.littlefs;
        }
        
        if (binUrl) {
          console.log(`Loading BIN directly from: ${binUrl}`);
          const response = await fetch(binUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch BIN file: ${response.statusText}`);
          }
          const blob = await response.blob();
          const data = await blob.arrayBuffer();
          return convertToBinaryString(new Uint8Array(data));
        }
      }
      
      // Option 2: Aus ZIP
      if (this.selectedFirmware?.zip_url) {
        const baseUrl = getCorsFriendyReleaseUrl(this.selectedFirmware.zip_url);
        const response = await fetch(`${baseUrl}/${fileName}`);
        const blob = await response.blob();
        const data = await blob.arrayBuffer();
        return convertToBinaryString(new Uint8Array(data));
      }
      
      // Option 3: Aus hochgeladener ZIP-Datei
      if (this.selectedFile && this.isZipFile) {
        const reader = new BlobReader(this.selectedFile);
        const zipReader = new ZipReader(reader);
        const entries = await zipReader.getEntries()
        console.log('Zip entries:', entries);
        console.log('Looking for file matching pattern:', fileName);
        const file = entries.find(entry => {
          if (fileName.startsWith('firmware-tbeam-.'))
            return !entry.filename.includes('s3') && new RegExp(fileName).test(entry.filename) && (fileName.endsWith('update.bin') === entry.filename.endsWith('update.bin'))
          return new RegExp(fileName).test(entry.filename) && (fileName.endsWith('update.bin') === entry.filename.endsWith('update.bin'))
        })
        if (file) {
          console.log('Found file:', file.filename);
          if (file?.getData) {
            const blob = await file.getData(new BlobWriter());
            const arrayBuffer = await blob.arrayBuffer();
            return convertToBinaryString(new Uint8Array(arrayBuffer));
          }
          throw new Error(`Could not find file with pattern ${fileName} in zip`);
        }
      } else if (this.selectedFile && !this.isZipFile) {
        // Option 4: Direkte BIN hochgeladen
        const buffer = await this.selectedFile.arrayBuffer();
        return convertToBinaryString(new Uint8Array(buffer));
      }
      
      throw new Error('Cannot fetch binary content without a file or firmware selected');
    },
    async connectEsp32(transport: Transport, terminal: Terminal): Promise<ESPLoader> {
      const loaderOptions = <LoaderOptions>{
        transport,
        baudrate: this.baudRate,
        enableTracing: false,
        terminal: {
          clean() {
            terminal.clear();
          },
          writeLine(data) {
            terminal.writeln(data);
          },
          write(data) {
            terminal.write(data);
          }
        }
      };
      const espLoader = new ESPLoader(loaderOptions);
      const chip = await espLoader.main();
      console.log("Detected chip:", chip);
      return espLoader;
    },
    async readSerial(port: SerialPort, terminal: Terminal): Promise<void> {
      const decoder = new TextDecoderStream();
      if (port.readable) {
        port.readable.pipeTo(decoder.writable);
      } else {
        throw new Error('Serial port is not readable');
      }
      const inputStream = decoder.readable;
      const reader = inputStream.getReader();

      while (true) {
        const{ value } = await reader.read();
        if (value) {
          terminal.write(value);
        }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    },
  },
})
