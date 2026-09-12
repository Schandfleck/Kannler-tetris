// Skaliert den kompletten Spielbereich anhand der aktuellen Fenstergröße,
// ohne dass die Canvas-Auflösung oder die Spiellogik angepasst werden muss.

const SCALE_FACTOR = 0.9; // <-- hier feinjustieren: 1.0 = maximal möglich, kleiner = kleiner

function fitGameToScreen() {
    const wrapper = document.getElementById('viewport-scaler');
    if (!wrapper) return;

    // Erst zurücksetzen, um die tatsächliche (unskalierte) Größe zu messen
    wrapper.style.transform = 'scale(1)';

    const naturalWidth = wrapper.offsetWidth;
    const naturalHeight = wrapper.offsetHeight;
    if (!naturalWidth || !naturalHeight) return;

    const margin = 10; // Sicherheitsabstand zum Bildschirmrand in px
    const availableWidth = window.innerWidth - margin;
    const availableHeight = window.innerHeight - margin;

    let scale = Math.min(
        availableWidth / naturalWidth,
        availableHeight / naturalHeight
    );

    scale *= SCALE_FACTOR;

    // Sinnvolle Grenzen, damit nichts winzig oder unscharf riesig wird
    scale = Math.max(0.3, Math.min(scale, 4));

    wrapper.style.transform = `scale(${scale})`;
}

// Neu berechnen bei Fenstergröße-/Orientierungsänderung
window.addEventListener('resize', fitGameToScreen);
window.addEventListener('orientationchange', fitGameToScreen);
window.addEventListener('load', fitGameToScreen);

// Neu berechnen, wenn Menü/Spielbereich per .hidden ein-/ausgeblendet wird,
// da sich dadurch die natürliche Größe des Wrappers ändert
document.addEventListener('DOMContentLoaded', () => {
    fitGameToScreen();

    const wrapper = document.getElementById('viewport-scaler');
    if (!wrapper) return;

    const observer = new MutationObserver(() => fitGameToScreen());
    observer.observe(wrapper, {
        attributes: true,
        attributeFilter: ['class'],
        subtree: true
    });
});
