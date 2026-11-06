const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const encryptedPath = process.argv[2];
if (!encryptedPath || !encryptedPath.endsWith('.key.enc')) process.exit(2);
const program = String.raw`
const fs=require('node:fs');
const crypto=require('node:crypto');
async function main(){
  const envelope=JSON.parse(fs.readFileSync(0,'utf8'));
  const target=JSON.parse(fs.readFileSync('/run/spec09-enrollment-target/provision.json','utf8'));
  if(envelope.companyId!==target.affiliationsCompanyId||envelope.environment!=='SANDBOX'||
    Date.parse(envelope.expiresAt)<=Date.now())throw Error('ENVELOPE_GUARD');
  const key=fs.readFileSync('/run/spec09-m2m-wrap/private.pem');
  const bytes=crypto.privateDecrypt({key,oaepHash:'sha256'},Buffer.from(envelope.ciphertext,'base64'));
  key.fill(0);const secret=bytes.toString('utf8');bytes.fill(0);
  const base='https://billing-spec09-sandbox:3443/api/v2/companies/'+target.billingCompanyId+'/fiscal-onboarding/SANDBOX';
  for(const suffix of ['','/status']){
    const response=await fetch(base+suffix,{headers:{'X-API-Key':secret,'X-Correlation-Id':crypto.randomUUID()},
      signal:AbortSignal.timeout(10000),redirect:'error'});
    if(!response.ok){let code='UNKNOWN';try{const body=await response.json();
      const raw=body?.code||body?.error?.code;
      if(typeof raw==='string'&&/^[A-Z0-9_]{2,80}$/.test(raw))code=raw;}catch{}
      process.stdout.write('M2M_HTTP_'+response.status+'_'+code+'\n');process.exitCode=1;return;}
    const data=await response.json();
    if(suffix==='/status'&&(!data.readyToIssue||data.blockers?.length)){
      process.stdout.write('M2M_NOT_READY\n');process.exitCode=1;return;
    }
  }
  process.stdout.write('M2M_HTTP_200_READY\n');
}
main().catch(error=>{const message=String(error?.message||'');
  const code=/^[A-Z0-9_]+$/.test(message)?message:
    message.includes('ENOENT')?'FILE_MISSING':
    message.includes('fetch failed')?'FETCH_FAILED':
    message.includes('decrypt')?'DECRYPT_FAILED':
    String(error?.code||error?.name||'UNCLASSIFIED').replace(/[^A-Z0-9_]/gi,'_').toUpperCase();
  process.stdout.write('M2M_ERROR_'+code+'\n');process.exitCode=1;});
`;
const child = spawnSync('docker', ['exec', '-i', 'aflilientions-api-1', 'node', '-e', program], {
  input: readFileSync(encryptedPath), encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024,
});
const marker = String(child.stdout).trim();
if (!/^M2M_(?:HTTP_\d+_[A-Z0-9_]+|HTTP_200_READY|NOT_READY|ERROR_[A-Z0-9_]+)$/.test(marker)) {
  process.stdout.write('M2M_PROBE_FAILED\n');
  process.exit(1);
}
process.stdout.write(marker + '\n');
process.exit(child.status === 0 ? 0 : 1);
