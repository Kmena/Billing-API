const { resolve } = require('node:path');

const { createCache } = require(
  resolve(__dirname, '../../node_modules/cache-manager/dist/index.cjs'),
);

const CACHE_MANAGER = 'CACHE_MANAGER';

class CacheModule {
  static register() {
    return {
      module: CacheModule,
      providers: [{ provide: CACHE_MANAGER, useFactory: () => createCache() }],
      exports: [CACHE_MANAGER],
    };
  }
}

module.exports = { CACHE_MANAGER, CacheModule };
