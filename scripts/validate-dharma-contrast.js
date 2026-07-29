const fs=require('fs');
const css=fs.readFileSync(require('path').join(__dirname,'..','src','styles','tokens.css'),'utf8');
function tokens(scope){
 const body=scope==='light'?css.split('.dark')[0]:css.split('.dark {')[1].split('}')[0];
 const t={};for(const m of body.matchAll(/(--dharma-[a-z-]+):\s*(#[0-9a-fA-F]{6})/g))t[m[1]]=m[2];return t;
}
const L=h=>{const c=h.replace('#','').match(/../g).map(x=>parseInt(x,16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]};
const R=(a,b)=>{const[x,y]=[L(a),L(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05)};
// The pairs components ACTUALLY render after migration.
const PAIRS=[
 ['body ink / page',            '--dharma-text-primary','--dharma-surface-bg',4.5],
 ['body ink / card',            '--dharma-text-primary','--dharma-surface-surface',4.5],
 ['secondary / card',           '--dharma-text-secondary','--dharma-surface-surface',4.5],
 ['secondary / page',           '--dharma-text-secondary','--dharma-surface-bg',4.5],
 ['Button default',             '--dharma-text-inverse','--dharma-accent-base',4.5],
 ['Button default :hover',      '--dharma-text-inverse','--dharma-accent-hover',4.5],
 ['Button link',                '--dharma-accent-on-tint','--dharma-surface-surface',4.5],
 ['Badge default',              '--dharma-accent-on-tint','--dharma-accent-tint-bg',4.5],
 ['Badge success',              '--dharma-success-text','--dharma-success-bg',4.5],
 ['Badge warning (ink subst.)', '--dharma-text-primary','--dharma-warning-bg',4.5],
 ['Badge critical/destructive', '--dharma-danger-text','--dharma-danger-bg',4.5],
 ['Badge info',                 '--dharma-info-text','--dharma-info-bg',4.5],
 ['Badge secondary',            '--dharma-text-secondary','--dharma-surface-hover',4.5],
 ['Badge outline',              '--dharma-text-primary','--dharma-surface-surface',4.5],
 ['StatusBadge NONE',           '--dharma-text-secondary','--dharma-surface-hover',4.5],
 ['StatusBadge LOW',            '--dharma-info-text','--dharma-info-bg',4.5],
 ['StatusBadge MEDIUM',         '--dharma-text-primary','--dharma-warning-bg',4.5],
 ['StatusBadge HIGH',           '--dharma-danger-text','--dharma-danger-bg',4.5],
 ['StatusBadge CRITICAL',       '--dharma-danger-text','--dharma-danger-bg',4.5],
 ['Button destructive',         '--dharma-danger-text','--dharma-danger-bg',4.5],
 ['Focus ring / page (1.4.11)', '--dharma-accent-base','--dharma-surface-bg',3.0],
 ['Focus ring / card (1.4.11)', '--dharma-accent-base','--dharma-surface-surface',3.0],
];
let fail=0;
for(const scope of ['light','dark']){
 const t=tokens(scope);
 console.log(`\n===== ${scope.toUpperCase()} =====`);
 for(const[name,fg,bg,min]of PAIRS){
  const r=R(t[fg],t[bg]);const ok=r>=min;if(!ok)fail++;
  console.log(`${ok?'PASS':'FAIL'}  ${r.toFixed(2).padStart(6)}:1 (min ${min})  ${name}`);
 }
}
console.log(`\n${fail===0?'ALL PAIRS PASS':fail+' FAILURES'}`);
process.exit(fail?1:0);
