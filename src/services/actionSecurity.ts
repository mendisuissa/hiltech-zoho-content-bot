import crypto from 'node:crypto';

export function holdHiltech(): void { throw Object.assign(new Error('P0_HILTECH_HELD'), {status:423}); }
export function heldResponse(res: any): any { return res.status(423).json({ok:false,error:'P0_HILTECH_HELD'}); }
export type CallerConfig = {token?:unknown;identity?:unknown};
export const callerConfig = (): CallerConfig => ({token:process.env.HILTECH_API_TOKEN,identity:process.env.HILTECH_CALLER_ID});
const identifier = (s:any): s is string => typeof s==='string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(s);
export function authenticateCaller(req:any, config:()=>CallerConfig=callerConfig): string|null {
  try {
    const {token,identity}=config(),header=req?.headers?.authorization;
    if(typeof token!=='string'||!/^[!-~]{32,512}$/.test(token)||!identifier(identity)||typeof header!=='string'||!/^Bearer [!-~]{32,512}$/.test(header)) return null;
    const a=Buffer.from(token),b=Buffer.from(header.slice(7));
    return a.length===b.length && crypto.timingSafeEqual(a,b) ? identity : null;
  } catch {return null;}
}
export function requireCaller(req:any,res:any): boolean {
  if(authenticateCaller(req)) return true;
  res.status(401).json({error:'Unauthorized'});return false;
}
export function trustedTelegramIdentity(req:any,config:()=>any=()=>({secret:process.env.TELEGRAM_WEBHOOK_SECRET,chat:process.env.TELEGRAM_APPROVER_CHAT_ID,users:process.env.TELEGRAM_APPROVER_USER_IDS})): string|null {
  try {
    const c=config(),secret=req?.headers?.['x-telegram-bot-api-secret-token'];
    if(typeof c.secret!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(c.secret)||typeof secret!=='string') return null;
    const a=Buffer.from(c.secret),b=Buffer.from(secret);if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) return null;
    const update=req.body;if(!update||!Number.isSafeInteger(update.update_id)||Boolean(update.message)===Boolean(update.callback_query)) return null;
    const item=update.callback_query||update.message,chat=update.callback_query?.message?.chat||item.chat;
    const users=typeof c.users==='string'?c.users.split(','):[];
    if(!users.length||!users.every((x:string)=>/^\d+$/.test(x))||!/^[-]?\d+$/.test(String(c.chat))||String(chat?.id)!==String(c.chat)||!Number.isSafeInteger(item.from?.id)||item.from?.is_bot!==false||!users.includes(String(item.from.id))) return null;
    return 'telegram:'+item.from.id;
  } catch {return null;}
}

// Trusted startup composition supplies the EXISTING P0 core, authority and target.
// No environment credential, signer, database or provider is loaded here.
export function createHiltechActionBoundary({createExecutor,createSafetyClient,store,auth,target,config,callerId,action,destination,account,capability,now=Date.now,operationTimeoutMs=30000}:any) {
  if(!identifier(callerId)||!identifier(account)||!identifier(destination)||!['hiltech.deliver_pack','hiltech.kernel_task'].includes(action)||typeof config!=='function'||!identifier(capability)||![target?.check,target?.write,target?.read,target?.lookup].every(f=>typeof f==='function')) throw Error('P0_CONFIGURATION_REQUIRED');
  const canonical=(v:any):string=>{
    if(v===null||['string','boolean'].includes(typeof v))return JSON.stringify(v);
    if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
    if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
    if(v&&Object.getPrototypeOf(v)===Object.prototype)return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
    throw Error('P0_INVALID_ARTIFACT');
  };
  const hash=(v:any)=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
  const exact=(v:any,keys:string[])=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
  function validate(a:any) {
    if(!exact(a,['action','destination','content','media','evidence','notBefore','expiresAt'])||a.action!==action||a.destination!==destination||!Number.isSafeInteger(a.notBefore)||!Number.isSafeInteger(a.expiresAt)||a.expiresAt<=a.notBefore||!Array.isArray(a.evidence)||!a.evidence.length||!a.evidence.every((s:any)=>typeof s==='string'&&s.trim()))throw Error('P0_INVALID_ARTIFACT');
    const p=a.content;
    if(!exact(p,['tenant','callerId','requestId','account','capability','target','version','payload'])||p.tenant!=='hiltech'||p.callerId!==callerId||p.account!==account||p.capability!==capability||![p.requestId,p.target,p.version].every(identifier))throw Error('P0_SCOPE_MISMATCH');
    // Frozen exact delivery text/HTML is escaped/rendered BEFORE submission.
    // Kernel payload is data to a single explicitly configured capability;
    // it must never be interpreted as instructions to choose another capability.
    if(!exact(p.payload,['text'])||typeof p.payload.text!=='string'||!p.payload.text.trim()||p.payload.text.length>100000)throw Error('P0_INVALID_PAYLOAD');
    if(!Array.isArray(a.media)||a.media.length>10)throw Error('P0_INVALID_MEDIA');
    for(const m of a.media){
      if(!exact(m,['sha256','mimeType','bytesBase64'])||!['image/png','image/jpeg','audio/mpeg'].includes(m.mimeType)||typeof m.bytesBase64!=='string'||m.bytesBase64.length>14000000)throw Error('P0_INVALID_MEDIA');
      const bytes=Buffer.from(m.bytesBase64,'base64');
      if(!bytes.length||bytes.toString('base64')!==m.bytesBase64||crypto.createHash('sha256').update(bytes).digest('hex')!==m.sha256||!(m.mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):m.mimeType==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255&&(bytes[1]&224)===224))throw Error('P0_INVALID_MEDIA');
    }
    if(action==='hiltech.kernel_task'&&a.media.length)throw Error('P0_KERNEL_MEDIA_UNSUPPORTED');
    return {status:'PASS',version:'hiltech-p0-1',hash:hash(a)};
  }
  const executor=createExecutor({store,auth,destinations:[destination],now,operationTimeoutMs,validateArtifact:validate,adapters:{[action]:{
    preflight:async(a:any)=>await target.check(a)===true,
    execute:async(a:any,ctx:any)=>target.write(a,ctx),
    verify:async(a:any,receipt:any)=>{const r=await target.read(receipt.externalId);return !!r&&r.externalId===receipt.externalId&&r.artifact && canonical(r.artifact)===canonical(a)&&r.tenant==='hiltech'&&r.destination===destination&&r.account===account&&r.action===action&&r.status===(action==='hiltech.deliver_pack'?'DELIVERED_TO_TELEGRAM':'COMPLETED');},
    lookup:async(a:any,ctx:any)=>target.lookup({artifact:a,idempotencyKey:ctx.idempotencyKey})
  }}});
  function caller(req:any){if(authenticateCaller(req,config)!==callerId)throw Error('P0_CALLER_REQUIRED');}
  function scoped(req:any,r:any){caller(req);if(!exact(r,['artifactId','requestId']))throw Error('P0_INVALID_REQUEST');const p=executor.preview(r.artifactId).artifact;validate(p);if(p.content.requestId!==r.requestId)throw Error('P0_REQUEST_SCOPE_MISMATCH');return p;}
  const client=createSafetyClient({generator:callerId,destination,now,submit(a:any,generator:string){return store.transaction(()=>{
    const prior=store.db.prepare('SELECT * FROM p0_artifacts WHERE generator=?').all(generator).find((row:any)=>JSON.parse(row.artifact).content.requestId===a.content.requestId);
    if(prior){if(prior.artifact!==canonical(a))throw Error('P0_REQUEST_ID_REUSED');return prior.id;}
    return executor.submit(a,generator);
  });}});
  return Object.freeze({
    submit(req:any,input:any){caller(req);if(!exact(input,['requestId','tenant','target','version','payload','media','evidence','notBefore','expiresAt'])||input.tenant!=='hiltech')throw Error('P0_INVALID_CANDIDATE');return client.submitCandidate({action,content:{tenant:input.tenant,callerId,requestId:input.requestId,account,capability,target:input.target,version:input.version,payload:input.payload},media:input.media,evidence:input.evidence,notBefore:input.notBefore,expiresAt:input.expiresAt});},
    approve(req:any,r:any,proof:any){scoped(req,r);executor.approve(r.artifactId,proof);return {status:'APPROVED'};},
    execute(req:any,r:any){scoped(req,r);return executor.execute(r.artifactId);},
    reconcile(req:any,r:any,proof:any){scoped(req,r);return executor.reconcile(r.artifactId,proof);},
    status(req:any,r:any){scoped(req,r);const row=store.get(r.artifactId);return {state:row.state==='REVIEW_PENDING'?'PACKAGE_READY':row.state==='APPROVED'?(executor.isAuthorized(row.id)?'APPROVED':'INVALID_APPROVAL'):row.state,delivery:row.state==='VERIFIED'&&action==='hiltech.deliver_pack'?'DELIVERED_TO_TELEGRAM':null,publishedExternally:false};},
    reviewer:Object.freeze({preview:executor.preview,review:executor.review,revoke:executor.revoke})
  });
}
