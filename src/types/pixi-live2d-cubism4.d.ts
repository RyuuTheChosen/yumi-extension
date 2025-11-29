declare module 'pixi-live2d-display/cubism4' {
	export * from 'pixi-live2d-display';
}

// Also allow importing the distributed build path which Vite can resolve at build time
declare module 'pixi-live2d-display/dist/cubism4' {
	export * from 'pixi-live2d-display';
}

// Allow importing the library build path used for ESM bundling
declare module 'pixi-live2d-display/lib/cubism4' {
	export * from 'pixi-live2d-display';
}
