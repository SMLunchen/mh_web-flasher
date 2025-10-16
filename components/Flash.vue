<template>
    <div>
        <button data-modal-target="flash-modal" data-modal-toggle="flash-modal"
            class="inline text-black bg-meshtastic hover:bg-gray-200 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 disabled:bg-gray-500 text-center"
            type="button" :disabled="!canFlash">
            {{ getFlashButtonText() }}
        </button>
        
        <button v-show="['nrf52840', 'rp2040'].includes(deviceStore.selectedArchitecture)" data-tooltip-target="tooltip-erase" class="mx-2 display-inline content-center px-3 py-2 text-xs font-medium text-center  hover:bg-gray-200 focus:ring-4 focus:outline-none focus:ring-blue-300 rounded-lg inline-flex items-center text-white hover:text-black"
            type="button"
            data-modal-target="erase-modal"
            data-modal-toggle="erase-modal">
            <Trash class="h-4 w-4" :class="{'animate-pulse': deviceStore.$state.selectedTarget?.hwModel }" />
        </button>
        
        <div id="tooltip-erase" role="tooltip" class="absolute z-10 invisible inline-block px-3 py-2 text-sm font-medium text-white transition-opacity duration-300  rounded-lg shadow-sm opacity-0 tooltip bg-zinc-700">
            {{ $t('flash.erase_flash_prefix') }} {{ deviceStore.selectedTarget?.displayName }}.
            <div class="tooltip-arrow" data-popper-arrow></div>
        </div>
        
        <div id="flash-modal" tabindex="-1" aria-hidden="true"
            class="dark hidden overflow-y-auto overflow-x-hidden fixed top-0 right-0 left-0 z-50 justify-center items-center w-full md:inset-0 h-[calc(100%-1rem)] max-h-full">
            
            <!-- nRF52/RP2040: UF2 Download -->
            <TargetsUf2 v-if="['nrf52840', 'rp2040'].includes(deviceStore.selectedArchitecture)" />
            
            <!-- ESP32: Serieller Flash -->
            <TargetsEsp32 v-if="deviceStore.selectedArchitecture.startsWith('esp32')" />
        </div>
        
        <div id="erase-modal" tabindex="-1" aria-hidden="true"
            class="dark hidden overflow-y-auto overflow-x-hidden fixed top-0 right-0 left-0 z-50 justify-center items-center w-full md:inset-0 h-[calc(100%-1rem)] max-h-full">
            <TargetsEraseUf2 v-if="['nrf52840', 'rp2040'].includes(deviceStore.selectedArchitecture)" />
        </div>
    </div>
</template>

<script lang="ts" setup>
import { checkIfRemoteFileExists } from '~/utils/fileUtils';
import { Trash } from 'lucide-vue-next';
import { useDeviceStore } from '../stores/deviceStore';
import { useFirmwareStore } from '../stores/firmwareStore';
import { useSerialMonitorStore } from '../stores/serialMonitorStore';

const firmwareStore = useFirmwareStore();
const deviceStore = useDeviceStore();
const serialMonitorStore = useSerialMonitorStore();

const fileExistsOnServer = ref(false);

// Watch für Firmware-Änderungen
watch(() => firmwareStore.$state.selectedFirmware, async () => {
    await preflightCheck();
});

// Watch für Device-Änderungen
watch(() => deviceStore.$state.selectedTarget, async () => {
    await preflightCheck();
});

const preflightCheck = async () => {
    if (!firmwareStore.hasOnlineFirmware) {
        fileExistsOnServer.value = false;
        return;
    }
    
    try {
        if (['nrf52840', 'rp2040'].includes(deviceStore.selectedArchitecture)) {
            // nRF52/RP2040: Prüfe UF2-Datei
            const firmwareVersion = firmwareStore.selectedFirmware!.id.replace(/^v/, '');
            const firmwareFile = `firmware-${deviceStore.selectedTarget.platformioTarget}-${firmwareVersion}.uf2`;
            
            console.log(`🔍 Checking UF2 file: ${firmwareFile}`);
            const url = firmwareStore.getReleaseFileUrl(firmwareFile);
            console.log(`🌐 UF2 URL: ${url}`);
            
            if (url) {
                fileExistsOnServer.value = await checkIfRemoteFileExists(url);
                console.log(`✅ UF2 file exists: ${fileExistsOnServer.value}`);
            } else {
                fileExistsOnServer.value = false;
                console.log(`❌ No UF2 URL found`);
            }
            
        } else if (deviceStore.selectedArchitecture.startsWith('esp32')) {
            // ESP32: Prüfe BIN-Datei
            if (firmwareStore.selectedFirmware?.bin_urls?.update) {
                console.log('🔍 Using direct bin_url for preflight check');
                fileExistsOnServer.value = await checkIfRemoteFileExists(firmwareStore.selectedFirmware.bin_urls.update);
            } else {
                // Fallback: Generiere Dateinamen
                const firmwareFile = `firmware-${deviceStore.selectedTarget.platformioTarget}-${firmwareStore.selectedFirmware!.id}.bin`;
                console.log(`🔍 Generated firmware filename: ${firmwareFile}`);
                const url = firmwareStore.getReleaseFileUrl(firmwareFile);
                fileExistsOnServer.value = await checkIfRemoteFileExists(url);
            }
        } else {
            fileExistsOnServer.value = false;
        }
    } catch (error) {
        console.error('❌ Preflight check failed:', error);
        fileExistsOnServer.value = false;
    }
};

// Flash-Button Text basierend auf Architektur
const getFlashButtonText = () => {
    const architecture = deviceStore.selectedTarget?.architecture || '';
    
    if (architecture.includes('nrf52') || architecture.includes('rp2040')) {
        return '📥 Download UF2';
    } else if (architecture.startsWith('esp32')) {
        return '⚡ Flash';
    } else {
        return '🔧 Flash';
    }
};

// Flash-Berechtigung prüfen
const canFlash = computed(() => {
    const hasDevice = deviceStore.selectedTarget?.hwModel > 0;
    const hasFirmware = firmwareStore.hasFirmwareFile || firmwareStore.hasOnlineFirmware;
    const isNotConnected = !serialMonitorStore.isConnected;
    
    console.log(`🔍 Flash permission check:`, {
        hasDevice,
        hasFirmware,
        isNotConnected,
        fileExistsOnServer: fileExistsOnServer.value,
        canFlash: isNotConnected && hasDevice && hasFirmware && (fileExistsOnServer.value || firmwareStore.hasFirmwareFile)
    });
    
    return isNotConnected && hasDevice && hasFirmware && (fileExistsOnServer.value || firmwareStore.hasFirmwareFile);
});

// Flash-Handler für direkten Button-Click (falls nötig)
const handleDirectFlash = async () => {
    if (!deviceStore.selectedTarget) {
        console.error('❌ No target selected');
        return;
    }
    
    try {
        const architecture = deviceStore.selectedTarget.architecture;
        const platformioTarget = deviceStore.selectedTarget.platformioTarget;
        const firmwareVersion = firmwareStore.selectedFirmware?.id || '';
        
        console.log(`🎯 Direct flash target: ${platformioTarget} (${architecture})`);
        
        if (architecture.includes('nrf52') || architecture.includes('rp2040')) {
            // nRF52/RP2040: UF2-Download
            const uf2FileName = `firmware-${platformioTarget}-${firmwareVersion}.uf2`;
            await firmwareStore.flashFirmware(uf2FileName, deviceStore.selectedTarget);
            
        } else if (architecture.startsWith('esp32')) {
            // ESP32: Serieller Flash
            const binFileName = `firmware-${platformioTarget}-${firmwareVersion}.bin`;
            await firmwareStore.flashFirmware(binFileName, deviceStore.selectedTarget);
            
        } else {
            throw new Error(`Unsupported architecture: ${architecture}`);
        }
        
    } catch (error) {
        console.error('❌ Direct flash error:', error);
        
        // Optional: Toast-Nachricht für Fehler
        if (import.meta.client) {
          try {
            const { useToastStore } = await import('../stores/toastStore');
            const toastStore = useToastStore();
            toastStore.error('Flash fehlgeschlagen', `Fehler: ${error.message}`);
          } catch (toastError) {
            console.warn('Toast store not available:', toastError);
          }
        }
    }
};

// Exportiere für Template-Zugriff
defineExpose({
    handleDirectFlash,
    getFlashButtonText,
    canFlash
});
</script>
