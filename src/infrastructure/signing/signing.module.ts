import { Global, Module } from '@nestjs/common';
import { XML_SIGNER } from './ports/xml-signer.port';
import { NodeXadesEpesSignerAdapter } from './adapters/node-xades-epes-signer.adapter';

@Global()
@Module({
  providers: [
    NodeXadesEpesSignerAdapter,
    {
      provide: XML_SIGNER,
      useExisting: NodeXadesEpesSignerAdapter,
    },
  ],
  exports: [XML_SIGNER],
})
export class SigningModule {}
