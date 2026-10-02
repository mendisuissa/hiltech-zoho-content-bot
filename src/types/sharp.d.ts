// Runtime implementation is provided by the pinned `sharp` dependency.
// Keep compilation deterministic even when optional native package metadata is
// unavailable during a no-script verification install.
declare module 'sharp' {
  const sharp: any;
  export default sharp;
}
