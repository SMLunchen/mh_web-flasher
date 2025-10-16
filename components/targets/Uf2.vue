<template>
    <div class="relative p-4 w-full max-w-4xl max-h-full">
        <div class="relative rounded-lg shadow bg-zinc-700">
            <FlashHeader />
            <div class="p-4 md:p-5">
                <ReleaseNotes />
                <ol v-if="firmwareStore.canShowFlash" class="relative border-s border-gray-200 border-gray-600 ms-3.5 mb-4 md:mb-5">
                    <li class="mb-10 ms-8">
                        <span class="absolute flex items-center justify-center w-6 h-6 rounded-full -start-3 ring-8 bg-cyan-900 text-gray-100 ring-gray-900">
                            1
                        </span>
                        <h3 class="flex items-start mb-1 text-lg font-semibold text-white">
                            {{ $t('flash.uf2.enter_dfu_mode') }}
                        </h3>
                        <div class="p-4 mb-4 my-2 text-sm rounded-lg bg-blue-50 bg-gray-800 text-blue-200" role="alert">
                            <span class="font-medium">
                                <Info class="h-4 w-4 inline" />
                                {{ $t('flash.uf2.dfu_firmware_clause') }} &lt; {{ deviceStore.enterDfuVersion }}, {{ $t('flash.uf2.dfu_firmware_clause_2') }} {{ deviceStore.dfuStepAction }}
                            </span>
                        </div>
                        <button type="button"
                            class="inline-flex items-center py-2 px-3 text-sm font-medium focus:outline-none bg-meshtastic rounded-lg hover:bg-white focus:z-10 focus:ring-4 focus:ring-gray-200 text-black"
                            @click="() => deviceStore.enterDfuMode($t)">
                            <FolderDown class="h-4 w-4 text-black" />
                            {{ $t('flash.uf2.enter_dfu') }}
                        </button>
                    </li>
                    <li class="mb-10 ms-8">
                        <span class="absolute flex items-center justify-center w-6 h-6 rounded-full -start-3 ring-8 bg-cyan-900 text-gray-100 ring-gray-900">
                            2
                        </span>
                        <h3 class="flex items-start mb-1 text-lg font-semibold text-white">
                            {{ $t('flash.uf2.ensure_drive_mounted') }}
                        </h3>
                        <span>
                            {{ $t('flash.uf2.drive_name_info') }}
                        </span>
                        <div>
                            <img v-if="deviceStore.isSelectedNrf" src="@/assets/img/dfu.png" :alt="$t('flash.uf2.dfu_drive')" />
                            <img v-else src="@/assets/img/uf2_rp2040.png" :alt="$t('flash.uf2.dfu_drive')" />
                        </div>
                    </li>
                    <li class="ms-8">
                        <span class="absolute flex items-center justify-center w-6 h-6 rounded-full -start-3 ring-8 bg-cyan-900 text-gray-100 ring-gray-900">
                            3
                        </span>
                        <h3 class="mb-1 text-lg font-semibold text-white">
                            {{ $t('flash.uf2.download_copy_uf2') }}
                        </h3>
                        <span>
                            {{ $t('flash.uf2.copy_instructions') }}
                        </span>
                        <div class="p-4 mb-4 my-2 text-sm rounded-lg bg-blue-50 bg-gray-800 text-blue-200" role="alert">
                            <span class="font-medium">
                                <Info class="h-4 w-4 inline" />
                                {{ $t('flash.uf2.auto_reboot_warning') }}
                            </span>
                        </div>
                    </li>
                    <li>
                        <label class="relative inline-flex items-center me-5 ml-8 my-2 cursor-pointer" v-if="canInstallInkHud">
                            <input type="checkbox" value="" class="sr-only peer" v-model="firmwareStore.shouldInstallInkHud">
                            <div class="w-11 h-6 rounded-full peer peer-focus:ring-4 bg-gray-400 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all border-gray-600 peer-checked:bg-red-600"></div>
                            <span class="ms-3 text-sm font-medium text-gray-100">{{ $t('flash.uf2.install_inkhud') }}</span>
                        </label>
                    </li>
                </ol>
                <div v-if="firmwareStore.canShowFlash">
                    <!-- Custom Firmware: Direkte UF2-Download -->
                    <button v-if="firmwareStore.selectedFirmware?.bin_urls" @click="downloadCustomUf2"
                        :disabled="isDownloading"
                        class="text-black inline-flex w-full justify-center bg-meshtastic hover:bg-gray-200 disabled:bg-gray-400 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center">
                        <span v-if="isDownloading">📥 {{ $t('flash.uf2.downloading') }}...</span>
                        <span v-else>📥 {{ $t('flash.uf2.download_uf2') }}</span>
                    </button>
                    
                    <!-- Standard Meshtastic Firmware: Link-Download -->
                    <a v-else-if="firmwareStore.selectedFirmware?.id" :href="downloadUf2FileUrl"
                        @click="handleLinkClick"
                        class="text-black inline-flex w-full justify-center bg-meshtastic hover:bg-gray-200 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center">
                        📥 {{ $t('flash.uf2.download_uf2') }}
                    </a>
                    
                    <!-- ZIP-Datei: FileSystem-Download -->
                    <button v-else @click="downloadUf2FileFs"
                        class="text-black inline-flex w-full justify-center bg-meshtastic hover:bg-gray-200 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center">
                        📥 {{ $t('flash.uf2.download_uf2') }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import {
  FolderDown,
  Info,
} from 'lucide-vue-next';
import { computed, ref } from 'vue';
import { useDeviceStore } from '../../stores/deviceStore';
import { useFirmwareStore } from '../../stores/firmwareStore';
import FlashHeader from './FlashHeader.vue';
import ReleaseNotes from './ReleaseNotes.vue';

const deviceStore = useDeviceStore();
const firmwareStore = useFirmwareStore();

const isDownloading = ref(false);

// Custom UF2-Download für deine Firmware
const downloadCustomUf2 = async () => {
    if (!deviceStore.selectedTarget || !firmwareStore.selectedFirmware) {
        console.error('❌ No target or firmware selected');
        return;
    }
    
    try {
        isDownloading.value = true;
        console.log('🔧 Starting custom UF2 download...');
        
        // Log the flash action
        firmwareStore.logFlash(deviceStore.selectedTarget, false);
        
        // Verwende die neue downloadUf2Firmware Methode
        await firmwareStore.downloadUf2Firmware(deviceStore.selectedTarget);
        
        console.log('✅ Custom UF2 download completed');
        
    } catch (error) {
        console.error('❌ Custom UF2 download failed:', error);
    } finally {
        isDownloading.value = false;
    }
};

// ZIP-Datei UF2-Download (bestehende Funktionalität)
const downloadUf2FileFs = () => {
    let suffix = "";
    if (firmwareStore.shouldInstallInkHud) {
        suffix = "-inkhud";
    }
    
    const searchRegex = new RegExp(`firmware-${deviceStore.selectedTarget.platformioTarget}${suffix}-.+.uf2`);
    console.log('🔍 Searching for UF2 in ZIP:', searchRegex);
    
    // Log the flash action
    firmwareStore.logFlash(deviceStore.selectedTarget, false);
    
    firmwareStore.downloadUf2FileSystem(searchRegex);
};

// Standard Meshtastic Link-Handler
const handleLinkClick = () => {
    console.log('🔗 Standard UF2 link clicked');
    
    // Log the flash action
    if (deviceStore.selectedTarget) {
        firmwareStore.logFlash(deviceStore.selectedTarget, false);
    }
};

const isNewFirmware = computed(() => {
    // Check for _not_ 2.5 firmware version
    return !firmwareStore.firmwareVersion.includes('2.5');
});

const canInstallInkHud = computed(() => {
    if (!isNewFirmware.value) return false;
    return deviceStore.selectedTarget?.hasInkHud === true;
});

// Standard Meshtastic UF2-URL (für Links)
const downloadUf2FileUrl = computed(() => {
    if (!firmwareStore.selectedFirmware?.id) return '';
    
    const firmwareVersion = firmwareStore.selectedFirmware.id.replace(/^v/, ''); // Nur am Anfang!
    let suffix = "";
    
    if (firmwareStore.shouldInstallInkHud) {
        suffix = "-inkhud";
    }
    
    const firmwareFile = `firmware-${deviceStore.selectedTarget.platformioTarget}${suffix}-${firmwareVersion}.uf2`;
    console.log('🔗 Standard UF2 file:', firmwareFile);
    
    return firmwareStore.getReleaseFileUrl(firmwareFile);
});
</script>
