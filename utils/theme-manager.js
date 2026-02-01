// ===========================================================
// GESTOR DE ASSETS Y TEMAS
// ===========================================================

const THEME_ASSETS = {
    normal: {
        icon: 'https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209689/u71QEFc_bet4rv.png',
        logo: 'https://res.cloudinary.com/djhgmmdjx/image/upload/v1759209688/vgJjqSM_oicebo.png'
    },
    christmas: {
        icon: 'https://res.cloudinary.com/djhgmmdjx/image/upload/v1762920149/cornenavidad_lxtqh3.webp',
        logo: 'https://res.cloudinary.com/djhgmmdjx/image/upload/v1763875732/NavidadCorneta_pjcdgq.webp'
    }
};

export function updateThemeAssets() {
    const isChristmas = document.body.classList.contains('tema-navidad');
    const assets = isChristmas ? THEME_ASSETS.christmas : THEME_ASSETS.normal;
    const logoImg = document.getElementById('app-logo');
    if (logoImg) logoImg.src = assets.logo;
    const iconLink = document.getElementById('app-icon');
    if (iconLink) iconLink.href = assets.icon;
}

export { THEME_ASSETS };
export default { updateThemeAssets, THEME_ASSETS };
