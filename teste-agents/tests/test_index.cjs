const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||'jsdom');
const fs=require('fs'),path=require('path'),assert=require('assert');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const errs=[];
function load(store){
  const vc=new VirtualConsole();vc.on('jsdomError',e=>errs.push(e.message));vc.on('error',e=>errs.push(String(e)));
  const d=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/',virtualConsole:vc,
    beforeParse(w){if(store)for(const k in store)w.localStorage.setItem(k,store[k]);}});
  return d.window;
}
function add(w,n,q,u){const D=w.document;D.getElementById('nome').value=n;D.getElementById('qtd').value=q;if(u)D.getElementById('un').value=u;
  D.getElementById('form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));}
let w=load();const D=()=>w.document;
const items=()=>D().querySelectorAll('#lista li:not(.vazio)').length;
const saved=()=>JSON.parse(w.localStorage.getItem('doceria_receita'));
['receita','form','nome','qtd','un','lista','erro'].forEach(i=>assert(D().getElementById(i),i));
assert.equal(D().querySelectorAll('#un option').length,8);
assert.equal(items(),0);
add(w,'Farinha','200','g');assert.equal(items(),1);
assert.deepEqual(saved().ingredientes[0],{nome:'Farinha',quantidade:200,unidade:'g'});
for(const [n,q] of [['','5'],['  ','5'],['Ovo','0'],['Ovo','-2'],['Ovo','']]){
  add(w,n,q);assert.equal(items(),1,`invalido ${n}/${q}`);
  assert(D().getElementById('erro').textContent.length>0);
  assert(D().querySelector('.invalid'));
}
add(w,'Ovo','3','unidade');assert.equal(items(),2);
assert.equal(D().getElementById('erro').textContent,'');
const r=D().getElementById('receita');r.value='Bolo';r.dispatchEvent(new w.Event('input'));
assert.equal(saved().receita,'Bolo');
const raw=w.localStorage.getItem('doceria_receita');
w=load({doceria_receita:raw});
assert.equal(items(),2);assert.equal(D().getElementById('receita').value,'Bolo');
D().querySelector('.rem').click();assert.equal(items(),1);assert.equal(saved().ingredientes.length,1);
w=load({doceria_receita:'{lixo'});assert.equal(items(),0); // JSON corrompido
w=load({doceria_receita:JSON.stringify({receita:'x',ingredientes:[{nome:'<img src=x onerror=alert(1)>',quantidade:1,unidade:'g'}]})});
assert.equal(D().querySelectorAll('#lista img').length,0);
assert.deepEqual(errs,[]);
console.log('OK: todos os testes passaram');
