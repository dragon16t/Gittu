const B = "https://static.prod-images.emergentagent.com/jobs/3c713776-5c1e-4a0e-a798-208d8fdeb68f/images/";

export const ART = {
  hero: `${B}271ac7a4e8114849df02b6e38f80c83ec49544eacea7edbab210a33786bbc51b.jpeg`,
  pulseCard: `${B}e6405f9138a021fb5dccd1f659aa282f7ab88baadf0801483eaead6b984e4a74.jpeg`,
  oddyCard: `${B}49c9298ec5efb79d6f56f59c3f9c7ad5ee95997be64c8e47e7c4b363be0ac5cd.jpeg`,
  sphere: `${B}e448a12ae394f6ea7338060196f97a6d0a6010a99ae282a6a8c6c164c314b9cb.jpeg`,
};

export const AVATARS = [
  `${B}86036da230302f92edcfd8176e5118cdd2b28461ba541f07684fd78c5e61e842.jpeg`,
  `${B}5edf8ecaccbfeaf9aa1fb85e6ca29c3f3f22fb27c867867dd6b60dbfb194bdb0.jpeg`,
  `${B}3336d98eb338cf0d42711b121404ae3b3d70b3f018f978e4c0276e3e9a97b63a.jpeg`,
  `${B}10f36b755530f1ff1f48c1c18d4b23ffbea311dcc1e0aec1a087f6cb17ebdccd.jpeg`,
];

export const avatarFor = (name = "") => AVATARS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length];

export const ago = (iso, nowMs = Date.now()) => {
  const s = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
