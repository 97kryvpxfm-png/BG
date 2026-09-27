// Держит SillyTavern активной в фоне на iOS во время генерации,
// проигрывая беззвучный звук. Включается и выключается в настройках расширений.

const MODULE = 'background_generation_ios';
const { eventSource, eventTypes, extensionSettings, saveSettingsDebounced } = SillyTavern.getContext();

extensionSettings[MODULE] ??= { enabled: false };
const settings = extensionSettings[MODULE];

// Создаём секунду тишины в формате WAV прямо в браузере
function makeSilentWav(seconds = 1, rate = 8000) {
    const samples = seconds * rate;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const write = (offset, text) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    write(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, samples * 2, true);
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

const audio = new Audio(makeSilentWav());
audio.loop = true;
audio.setAttribute('playsinline', '');

let unlocked = false;
let active = false;
let safetyTimer = null;

// iOS разрешает звук только после нажатия пользователя, поэтому «разблокируем» его на первом касании
function unlock() {
    if (unlocked || !settings.enabled) return;
    audio.play()
        .then(() => {
            unlocked = true;
            if (!active) audio.pause();
        })
        .catch(() => {});
}
document.addEventListener('touchend', unlock, true);
document.addEventListener('click', unlock, true);
document.addEventListener('keydown', unlock, true);

function start(_type, _options, dryRun) {
    if (!settings.enabled || dryRun) return;
    active = true;
    audio.play().catch(() => {});
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: 'SillyTavern: идёт генерация' });
    }
    clearTimeout(safetyTimer);
    safetyTimer = setTimeout(stop, 15 * 60 * 1000); // на всякий случай выключаемся через 15 минут
}

function stop() {
    active = false;
    clearTimeout(safetyTimer);
    audio.pause();
}

eventSource.on(eventTypes.GENERATION_STARTED, start);
eventSource.on(eventTypes.GENERATION_ENDED, stop);
eventSource.on(eventTypes.GENERATION_STOPPED, stop);

// Переключатель в меню расширений
jQuery(() => {
    const html = `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Background Generation (iOS)</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <label class="checkbox_label">
                <input type="checkbox" id="bggen_enabled">
                <span>Не прерывать генерацию в фоне</span>
            </label>
            <small>Во время генерации играет тишина, чтобы iOS не замораживала страницу. Другая музыка при этом встаёт на паузу.</small>
        </div>
    </div>`;
    $('#extensions_settings2').append(html);
    $('#bggen_enabled')
        .prop('checked', settings.enabled)
        .on('change', function () {
            settings.enabled = this.checked;
            saveSettingsDebounced();
            if (!settings.enabled) stop();
        });
});
