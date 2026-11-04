import * as THREE from "three";
import { ROAD_SEGMENT_LENGTH, type RaceToWinQuality } from "./environment";

/** Recycled, decorative beach scenery. Never affects the authoritative race. */
export class RaceToWinCity {
  public readonly object = new THREE.Group();
  private readonly segments: THREE.Group[] = [];
  private readonly segmentIndices: number[] = [];
  private readonly geometry: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  public constructor(quality: RaceToWinQuality) {
    this.object.name = "race-to-win-coastal-scenery";
    const trunk = this.geometryItem(new THREE.CylinderGeometry(0.24, 0.4, 7, 7));
    const leaf = this.geometryItem(this.createFrond());
    const sand = this.geometryItem(new THREE.PlaneGeometry(80, ROAD_SEGMENT_LENGTH));
    const ocean = this.geometryItem(new THREE.PlaneGeometry(100, ROAD_SEGMENT_LENGTH));
    const trunkMat = this.materialItem(new THREE.MeshStandardMaterial({color:"#a97845",roughness:1}));
    const leafMat = this.materialItem(new THREE.MeshStandardMaterial({color:"#3d7e12",roughness:0.95,side:THREE.DoubleSide}));
    const sandMat = this.materialItem(new THREE.MeshStandardMaterial({color:"#e8cb98",roughness:1}));
    const gardenMat = this.materialItem(new THREE.MeshStandardMaterial({color:"#315b16",roughness:1}));
    const waterMat = this.materialItem(new THREE.MeshStandardMaterial({color:"#007eaa",roughness:0.45,metalness:0}));
    for (let index = -1; index < quality.roadSegments - 1; index++) {
      const group = new THREE.Group();
      const logicalIndex = index;
      const left = new THREE.Mesh(sand,gardenMat);
      left.rotation.x=-Math.PI/2;left.position.set(-52,-0.07,0);group.add(left);
      const right = new THREE.Mesh(sand,sandMat);
      right.rotation.x=-Math.PI/2;right.scale.x=0.19;right.position.set(19,-0.07,0);group.add(right);
      const sea = new THREE.Mesh(ocean,waterMat);
      sea.rotation.x=-Math.PI/2;sea.scale.x=3;sea.position.set(176.6,-0.09,0);group.add(sea);
      for (let n=0;n<4;n++) {
        const z=-36+n*24;
        for (const side of [-1,1]) {
          const x=side*(16+(n%3)*3);
          const palm=new THREE.Group();
          const stem=new THREE.Mesh(trunk,trunkMat);
          stem.position.y=3.5;stem.rotation.z=side*0.08;palm.add(stem);
          for(let k=0;k<7;k++){
            const frond=new THREE.Mesh(leaf,leafMat);
            frond.position.set(-side*0.28,7,0);
            frond.rotation.y=k*Math.PI*2/7;
            frond.castShadow=quality.shadows;
            palm.add(frond);
          }
          palm.position.set(x,0,z+(logicalIndex%2)*2);
          group.add(palm);
        }
      }
      this.addBeachProps(group, quality.shadows);
      this.segments.push(group);
      this.segmentIndices.push(index);
      this.object.add(group);
    }
  }
  private createFrond(): THREE.BufferGeometry {
    const vertices:number[]=[]; const indices:number[]=[];
    for(let i=0;i<=12;i++){
      const t=i/12;
      const width=Math.sin(Math.PI*t)*0.52*(i%2===0?1:0.7);
      const y=Math.sin(Math.PI*t)*0.85-t*t*1.4;
      vertices.push(-width,y,t*4.8,width,y,t*4.8);
      if(i<12){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
    geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
  }
  private addBeachProps(group:THREE.Group, shadows:boolean):void {
    const box=this.geometryItem(new THREE.BoxGeometry(1,1,1));
    const roof=this.geometryItem(new THREE.ConeGeometry(4.6,2.6,12));
    const canopy=this.geometryItem(new THREE.ConeGeometry(2.3,0.9,12,1,true));
    canopy.clearGroups();for(let i=0;i<12;i++)canopy.addGroup(i*3,3,i%2);
    const surface=(color:string)=>this.materialItem(new THREE.MeshStandardMaterial({color,roughness:0.9,side:THREE.DoubleSide}));
    const wood=surface("#aa7946"),red=surface("#e72e34"),white=surface("#fff6e6"),thatch=surface("#c89c56"),glass=surface("#255f71");
    const mesh=(geometry:THREE.BufferGeometry,material:THREE.Material|THREE.Material[],x:number,y:number,z:number,sx=1,sy=1,sz=1)=>{
      const item=new THREE.Mesh(geometry,material);item.position.set(x,y,z);item.scale.set(sx,sy,sz);
      item.castShadow=shadows;item.receiveShadow=true;group.add(item);return item;
    };
    for(const z of [-24,24]){
      mesh(box,wood,20.5,1.4,z,0.08,2.8,0.08);
      mesh(canopy,[red,white],20.5,3,z);
      mesh(box,wood,22,0.5,z+1.4,1.1,0.12,2);
      mesh(box,white,22,1,z+0.6,1.1,1.1,0.1).rotation.x=-0.25;
    }
    mesh(box,wood,-21,1.3,-12,6,2.6,5);mesh(roof,thatch,-21,4.2,-12);
    mesh(box,glass,-21,2,-9.45,4.8,1.1,0.08);mesh(box,thatch,-21,1.35,-9.2,6.5,0.2,0.7);
    for(const x of [17.8,20.2])for(const z of [6.8,9.2])mesh(box,red,x,1.7,z,0.18,3.4,0.18).rotation.z=x<19?-0.1:0.1;
    mesh(box,red,19,3.4,8,3.5,0.2,3.5);mesh(box,red,19,4.5,8,2.7,2,2.7);
    mesh(box,glass,19,4.7,9.36,1.8,0.9,0.04);mesh(box,white,19,5.6,8,3.4,0.15,3.4);
    mesh(box,white,19,4,9.4,2.7,0.12,0.12);
  }
  private geometryItem<T extends THREE.BufferGeometry>(value:T):T {this.geometry.push(value);return value;}
  private materialItem<T extends THREE.Material>(value:T):T {this.materials.push(value);return value;}
  public update(distanceMeters:number):void {
    const scroll=distanceMeters%ROAD_SEGMENT_LENGTH;
    for(let i=0;i<this.segments.length;i++)this.segments[i]!.position.z=scroll-this.segmentIndices[i]!*ROAD_SEGMENT_LENGTH;
  }
  public dispose():void {
    for(const item of this.geometry)item.dispose();
    for(const item of this.materials)item.dispose();
  }
}
