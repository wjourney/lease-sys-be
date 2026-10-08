import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plusMonths, rentPeriod, dayAfter } from '../src/common/utils/rent-period';
import { RentBillingService } from '../src/modules/incomes/rent-billing.service';
import { planUnitTypes } from '../src/modules/projects/unit-type-migration';
import { deleteOrderGraph, orderDeletionGraph, deletionSummary } from '../src/modules/orders/order-deletion';
import { movements, totals } from '../src/modules/finance/ledger';
const actor: any = { id:'admin', name:'管理员', role:'SUPER_ADMIN' };
const date = (v: string) => new Date(v);
function lease(start: string) { const startsOn = date(start); return { id:'order', startsOn, endsOn:new Date(plusMonths(startsOn,12).getTime()-86400000), billingVersion:2, paymentIntervalMonths:1, monthlyRent:'15000', firstPeriodProration:true,lastPeriodProration:true,rentDueDay:10, currency:'HKD' }; }
for (const start of ['2026-10-02','2026-01-31','2024-02-29','2025-08-31']) test(`full-year rent has 12 continuous fixed-price periods from ${start}`, () => {
  const o=lease(start); let cursor=o.startsOn; const periods:any[]=[];
  while(cursor<=o.endsOn) { const p=rentPeriod(o,cursor); periods.push(p); assert.equal(p.amount.toFixed(2),'15000.00'); cursor=dayAfter(p.end); assert.ok(periods.length<=12); }
  assert.equal(periods.length,12); assert.equal(periods[11].end.getTime(),o.endsOn.getTime());
});
test('partial final rental month prorates once and respects opt-out', () => {
  const o={...lease('2026-01-15'),endsOn:date('2026-02-28')};
  assert.equal(rentPeriod(o,date('2026-02-15')).amount.toFixed(2),'7500.00');
  assert.equal(rentPeriod({...o,lastPeriodProration:false},date('2026-02-15')).amount.toFixed(2),'15000.00');
});
test('full-term generation is idempotent and migration preserves void/deleted billing periods', async () => {
  const rows:any[]=[];
  const tx:any={ income:{ findUnique:async({where}:any)=>rows.find(r=>r.sourceKey===where.sourceKey),findMany:async()=>rows, create:async({data}:any)=>{const r={id:String(rows.length),...data};rows.push(r);return r;} } };
  const service=new RentBillingService(tx,{} as any);const o=lease('2026-01-31');
  await service.fullTerm(tx,o,actor);await service.fullTerm(tx,o,actor);assert.equal(rows.length,12);
  rows[0].status='VOID'; rows[0].sourceKey=null; rows[0].deletedAt=new Date(); const original=rows[0];
  rows.splice(5,1);await service.fullTerm(tx,o,actor,true);assert.equal(rows.length,12);assert.equal(rows[0],original);assert.equal(rows[0].status,'VOID');
});
test('legacy types split by actual unit attributes, preserve values and remain stable on reruns', () => {
  const units=[{id:'one',unitTypeCode:'OLD',building:'A座',floor:'2',area:'30',layout:'一房',extra:{age:'5'},minRent:'100',maxRent:'200',referenceRent:'150'},{id:'two',unitTypeCode:'OLD',building:'B座',floor:'3',area:'40',layout:'两房',extra:{},minRent:'200',maxRent:'300',referenceRent:'250'}];
  const plan=planUnitTypes({typeConfigs:[{code:'OLD',name:'大单位'}]},units);assert.equal(plan.types.length,2);assert.equal(plan.incomplete.length,1);assert.equal(plan.types[1].age,undefined);
  const nextUnits=units.map(u=>({...u,unitTypeCode:plan.assignments.find(a=>a.id===u.id)!.code}));
  const second=planUnitTypes({typeConfigs:plan.types},nextUnits);assert.deepEqual(second.types,plan.types);assert.equal(second.assignments.length,0);assert.equal(second.incomplete.length,1);
});
function deletionFixture() {
 const tables:any={income:[{id:'bill',recordType:'RECEIVABLE',status:'OPEN',depositOffsetAmount:'0'},{id:'receipt',recordType:'RECEIPT',status:'PENDING'}],commission:[{id:'commission'}],expense:[{id:'expense',paidAmount:'0'}],invoice:[{id:'invoice'}],material:[{id:'material'}],order:[{id:'order',orderNo:'R1',revision:1}]};
 const tx:any={};for(const [name,rows] of Object.entries(tables) as any)tx[name]={findMany:async()=>rows,updateMany:async({where,data}:any)=>{Object.assign(rows.find((r:any)=>r.id===where.id),data);return {count:1};},findUnique:async({where}:any)=>rows.find((r:any)=>r.id===where.id)};
 return {tables,tx};
}
test('order deletion cascades records with audit and releases occupancy',async()=>{
 const {tables,tx}=deletionFixture();assert.equal(deletionSummary(await orderDeletionGraph(tx,'order')).bills,1);
 await deleteOrderGraph(tx,actor,tables.order[0],'录入错误');
 for(const rows of Object.values(tables) as any)for(const r of rows){assert.ok(r.deletedAt);assert.equal(r.operationLogs[0].action,'DELETE');}
 assert.equal(tables.order[0].occupancyState,'RELEASED');assert.equal(tables.order[0].nextBillOn,null);
});
for(const kind of ['receipt','expense','deposit'])test(`actual ${kind} prevents deletion before any write`,async()=>{
 const {tables,tx}=deletionFixture();if(kind==='receipt')tables.income[1].status='CONFIRMED';if(kind==='expense')tables.expense[0].paidAmount='1';if(kind==='deposit')tables.income[0].depositOffsetAmount='1';
 await assert.rejects(deleteOrderGraph(tx,actor,tables.order[0],'录入错误'));assert.ok(!tables.order[0].deletedAt);assert.ok(!tables.material[0].deletedAt);
});
test('reversed receipts keep their original and opposite ledger entries after deletion',async()=>{
 const {tables,tx}=deletionFixture();Object.assign(tables.income[1],{status:'REVERSED',amount:'100',receivedOn:date('2026-10-01'),updatedAt:date('2026-10-02'),currency:'HKD',feeType:'RENT',confirmedAt:date('2026-10-01')});
 await deleteOrderGraph(tx,actor,tables.order[0],'更正后删除');const entries=movements(tables.income,[]);assert.equal(entries.length,2);assert.equal(totals(entries).net,'0.00');
});
