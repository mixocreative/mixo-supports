// Disposable, read-only local probe. Supply DENTAL_PROBE_FIXTURE; never commit patient geometry.
import { readFileSync } from 'node:fs';
import { proposeDentalOrientation, rotationToDentalPose, rotationToPlateDown } from '../src/core/analysis/dental';
import { DentalOpeningRaycaster } from '../src/core/analysis/dental';
import { dentalAllowedVertices } from '../src/core/analysis/dentalPolicy';
import { runPlacementJob, filterDentalPlacement } from '../src/supports/jobRunner';
import { defaultSupportSettings, toPlacementSettings } from '../src/core/supports/settings';
import { inverseTransformPoint } from '../src/state/transform';
import { applyToDirection, applyToPoint, placementMatrix, transformPositions } from '../src/core/transform';
import type { Vector } from '../src/core/vec3';
import { parseStl } from './test-support/rustImport';

const file = process.env.DENTAL_PROBE_FIXTURE;
if (!file) throw new Error('DENTAL_PROBE_FIXTURE is required');
const bytes = readFileSync(file);
const mesh = parseStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const base = proposeDentalOrientation(mesh);
if (base.kind !== 'proposal') throw new Error(`Original pose inconclusive: ${base.reason}`);
const angle = (a: Vector, b: Vector) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
const original = base.rim.openingDirection;
console.log(JSON.stringify({kind:'original',vertices:mesh.positions.length/3,faces:mesh.indices.length/3,opening:original,openingVersusDownDegrees:angle(original,[0,-1,0]),detectorRotation:rotationToPlateDown(original),confidence:base.diagnostics.confidence,boundary:base.rim.boundaryKind}));
function frontAxis(sample: typeof mesh, rim: typeof base.rim): {front:Vector; occupancy:[number,number]} {
  const pts:[number,number][]=[];let mu=0,mv=0;
  for(let i=0;i<sample.positions.length;i+=3){const d:Vector=[sample.positions[i]!-rim.centroid[0],sample.positions[i+1]!-rim.centroid[1],sample.positions[i+2]!-rim.centroid[2]];const u=d[0]*rim.tangent[0]+d[1]*rim.tangent[1]+d[2]*rim.tangent[2],v=d[0]*rim.bitangent[0]+d[1]*rim.bitangent[1]+d[2]*rim.bitangent[2];pts.push([u,v]);mu+=u;mv+=v;}
  mu/=pts.length;mv/=pts.length;let suu=0,svv=0,suv=0;
  for(const [u,v] of pts){suu+=(u-mu)**2;svv+=(v-mv)**2;suv+=(u-mu)*(v-mv);}
  const theta=0.5*Math.atan2(2*suv,suu-svv),major:[number,number]=[Math.cos(theta),Math.sin(theta)],minor:[number,number]=[-Math.sin(theta),Math.cos(theta)];
  const transformed=pts.map(([u,v])=>[(u-mu)*major[0]+(v-mv)*major[1],(u-mu)*minor[0]+(v-mv)*minor[1]] as [number,number]);let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const [x,y] of transformed){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  const occupancy:[Set<string>,Set<string>]=[new Set(),new Set()];for(const [x,y] of transformed){const fx=(x-minX)/(maxX-minX),fy=(y-minY)/(maxY-minY);if(fx<=0.3||fx>=0.7)continue;const end=fy<0.22?0:fy>0.78?1:-1;if(end>=0)occupancy[end as 0|1].add(`${Math.floor(fx*40)},${Math.floor(fy*40)}`);}
  const sign=occupancy[0].size>occupancy[1].size?-1:1;
  return {front:[sign*(minor[0]*rim.tangent[0]+minor[1]*rim.bitangent[0]),sign*(minor[0]*rim.tangent[1]+minor[1]*rim.bitangent[1]),sign*(minor[0]*rim.tangent[2]+minor[1]*rim.bitangent[2])],occupancy:[occupancy[0].size,occupancy[1].size]};
}
if (process.env.DENTAL_PROBE_MODE === 'rim') {
  const coordinates: [number, number][] = [];
  for (let offset=0; offset<base.rim.points.length; offset+=3) {
    const d: Vector = [base.rim.points[offset]!-base.rim.centroid[0],base.rim.points[offset+1]!-base.rim.centroid[1],base.rim.points[offset+2]!-base.rim.centroid[2]];
    coordinates.push([d[0]*base.rim.tangent[0]+d[1]*base.rim.tangent[1]+d[2]*base.rim.tangent[2],d[0]*base.rim.bitangent[0]+d[1]*base.rim.bitangent[1]+d[2]*base.rim.bitangent[2]]);
  }
  const xs=coordinates.map(p=>p[0]), ys=coordinates.map(p=>p[1]);
  console.log(JSON.stringify({kind:'rim',pointCount:coordinates.length,centroid:base.rim.centroid,tangent:base.rim.tangent,bitangent:base.rim.bitangent,min:[Math.min(...xs),Math.min(...ys)],max:[Math.max(...xs),Math.max(...ys)],width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}));
  process.exit(0);
}
if (process.env.DENTAL_PROBE_MODE === 'mask') {
  const opening=new DentalOpeningRaycaster(mesh,base.rim);
  const mask=dentalAllowedVertices({rim:base.rim,stamps:[]},opening,mesh.positions,new Float32Array(mesh.positions.length));
  let count=0,minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity,minD=Infinity,maxD=-Infinity;
  for(let vertex=0;vertex<mask.length;vertex++)if(mask[vertex]){
    count++;
    const i=vertex*3,d:Vector=[mesh.positions[i]!-base.rim.centroid[0],mesh.positions[i+1]!-base.rim.centroid[1],mesh.positions[i+2]!-base.rim.centroid[2]];
    const u=d[0]*base.rim.tangent[0]+d[1]*base.rim.tangent[1]+d[2]*base.rim.tangent[2],v=d[0]*base.rim.bitangent[0]+d[1]*base.rim.bitangent[1]+d[2]*base.rim.bitangent[2],depth=d[0]*original[0]+d[1]*original[1]+d[2]*original[2];
    minU=Math.min(minU,u);maxU=Math.max(maxU,u);minV=Math.min(minV,v);maxV=Math.max(maxV,v);minD=Math.min(minD,depth);maxD=Math.max(maxD,depth);
  }
  console.log(JSON.stringify({kind:'mask',count,total:mask.length,projectedWidth:maxU-minU,projectedHeight:maxV-minV,depth:[minD,maxD],footprintCells:base.rim.visibilityMask.reduce((a,b)=>a+b,0)}));
  process.exit(0);
}
if (process.env.DENTAL_PROBE_MODE === 'contacts') {
  const orientation={position:[0,0,0] as Vector,rotation:rotationToPlateDown(original)};
  const job={mesh,orientation,settings:toPlacementSettings(defaultSupportSettings),dental:{rim:base.rim,stamps:[]}};
  const generic=runPlacementJob(job);
  const dental=filterDentalPlacement(job,generic);
  const depths=dental.points.map(p=>{const local=inverseTransformPoint(orientation,p.position),d:Vector=[local[0]-base.rim.centroid[0],local[1]-base.rim.centroid[1],local[2]-base.rim.centroid[2]];return d[0]*original[0]+d[1]*original[1]+d[2]*original[2];}).sort((a,b)=>a-b);
  console.log(JSON.stringify({kind:'contacts',generic:generic.points.length,dental:dental.points.length,depthQuantiles:[0,.1,.25,.5,.75,.9,1].map(q=>depths[Math.floor(q*(depths.length-1))])}));
  process.exit(0);
}
if (process.env.DENTAL_PROBE_MODE === 'front') {
  const pts: [number,number][]=[];
  for(let i=0;i<mesh.positions.length;i+=3){
    const d:Vector=[mesh.positions[i]!-base.rim.centroid[0],mesh.positions[i+1]!-base.rim.centroid[1],mesh.positions[i+2]!-base.rim.centroid[2]];
    pts.push([d[0]*base.rim.tangent[0]+d[1]*base.rim.tangent[1]+d[2]*base.rim.tangent[2],d[0]*base.rim.bitangent[0]+d[1]*base.rim.bitangent[1]+d[2]*base.rim.bitangent[2]]);
  }
  const mu=pts.reduce((s,p)=>s+p[0],0)/pts.length,mv=pts.reduce((s,p)=>s+p[1],0)/pts.length;
  const suu=pts.reduce((s,p)=>s+(p[0]-mu)**2,0)/pts.length,svv=pts.reduce((s,p)=>s+(p[1]-mv)**2,0)/pts.length,suv=pts.reduce((s,p)=>s+(p[0]-mu)*(p[1]-mv),0)/pts.length;
  const theta=0.5*Math.atan2(2*suv,suu-svv);
  const major:[number,number]=[Math.cos(theta),Math.sin(theta)],minor:[number,number]=[-Math.sin(theta),Math.cos(theta)];
  const transformed=pts.map(p=>[(p[0]-mu)*major[0]+(p[1]-mv)*major[1],(p[0]-mu)*minor[0]+(p[1]-mv)*minor[1]] as [number,number]);
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const [x,y] of transformed){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  const occupied=(low:boolean)=>{const cells=new Set<string>();for(const [x,y] of transformed){const fy=(y-minY)/(maxY-minY),fx=(x-minX)/(maxX-minX);if((low?fy<0.22:fy>0.78)&&fx>0.3&&fx<0.7)cells.add(`${Math.floor(fx*40)},${Math.floor(fy*40)}`);}return cells.size;};
  const plate:Vector=[0,-1,0],dp=plate[0]*original[0]+plate[1]*original[1]+plate[2]*original[2];
  const downhill:Vector=[(plate[0]-dp*original[0])/Math.sin(angle(original,plate)*Math.PI/180),(plate[1]-dp*original[1])/Math.sin(angle(original,plate)*Math.PI/180),(plate[2]-dp*original[2])/Math.sin(angle(original,plate)*Math.PI/180)];
  const minor3:Vector=[minor[0]*base.rim.tangent[0]+minor[1]*base.rim.bitangent[0],minor[0]*base.rim.tangent[1]+minor[1]*base.rim.bitangent[1],minor[0]*base.rim.tangent[2]+minor[1]*base.rim.bitangent[2]];
  console.log(JSON.stringify({kind:'front',extent:[maxX-minX,maxY-minY],major,minor,minor3,angleMinorToDownhill:angle(minor3,downhill),centralOccupancyAtMinorEnds:[occupied(true),occupied(false)],downhill}));
  process.exit(0);
}
if (process.env.DENTAL_PROBE_MODE === 'pose100') {
  let state=20261024;
  const random=()=>((state=(1664525*state+1013904223)>>>0)/2**32);
  let proposals=0,abstentions=0,maxError=0;
  for(let trial=0;trial<100;trial++){
    const scramble:Vector=[(random()*2-1)*Math.PI,(random()*2-1)*Math.PI,(random()*2-1)*Math.PI];
    const turned={positions:transformPositions(mesh.positions,placementMatrix({position:[0,0,0],rotation:scramble})),indices:mesh.indices};
    const found=proposeDentalOrientation(turned);
    if(found.kind!=='proposal'){abstentions++;continue;}
    const pose=rotationToDentalPose(turned,found.rim);
    if(!pose){abstentions++;continue;}
    proposals++;
    const restored=placementMatrix({position:[0,0,0],rotation:pose});
    for(let index=0;index<mesh.positions.length/3;index+=1013){
      const at=index*3;
      const point=applyToPoint(restored,turned.positions[at]!,turned.positions[at+1]!,turned.positions[at+2]!);
      maxError=Math.max(maxError,Math.hypot(point[0]-mesh.positions[at]!,point[1]-mesh.positions[at+1]!,point[2]-mesh.positions[at+2]!));
    }
  }
  console.log(JSON.stringify({kind:'pose100',seed:20261024,trials:100,proposals,abstentions,maxSampledVertexErrorMm:maxError}));
  process.exit(0);
}
let seed = 20261024;
const rand = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
const errors: number[] = [];
const failures: number[] = [];
const fronts: number[]=[];
const baselineFront=frontAxis(mesh,base.rim);
for (let index=0; index<12; index++) {
  const rotation: Vector = [(rand()*2-1)*Math.PI,(rand()*2-1)*Math.PI,(rand()*2-1)*Math.PI];
  const matrix = placementMatrix({position:[0,0,0],rotation});
  const turned = {positions:transformPositions(mesh.positions,matrix),indices:mesh.indices};
  const found = proposeDentalOrientation(turned);
  const expected = applyToDirection(matrix,...original);
  if (found.kind === 'proposal') { errors.push(angle(expected,found.rim.openingDirection)); fronts.push(angle(applyToDirection(matrix,...baselineFront.front),frontAxis(turned,found.rim).front)); }
  else failures.push(index);
}
console.log(JSON.stringify({kind:'summary',seed:20261024,poses:12,proposals:errors.length,inconclusive:failures,maxOpeningErrorDegrees:Math.max(...errors),maxFrontErrorDegrees:Math.max(...fronts),frontOccupancyBaseline:baselineFront.occupancy,front:baselineFront.front}));
