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
    const leaf = this.geometryItem(new THREE.ConeGeometry(1.25, 5.6, 5));
    const sand = this.geometryItem(new THREE.PlaneGeometry(80, ROAD_SEGMENT_LENGTH));
    const ocean = this.geometryItem(new THREE.PlaneGeometry(100, ROAD_SEGMENT_LENGTH));
    const trunkMat = this.materialItem(new THREE.MeshStandardMaterial({color:"#a97845",roughness:1}));
    const leafMat = this.materialItem(new THREE.MeshStandardMaterial({color:"#1da95d",roughness:0.95,side:THREE.DoubleSide}));
    const sandMat = this.materialItem(new THREE.MeshStandardMaterial({color:"#f2d48d",roughness:1}));
    const waterMat = this.materialItem(new THREE.MeshStandardMaterial({color:"#19b9d5",roughness:0.45,metalness:0}));
    for (let index = -1; index < quality.roadSegments - 1; index++) {
      const group = new THREE.Group();
      const logicalIndex = index;
      const left = new THREE.Mesh(sand,sandMat);
      left.rotation.x=-Math.PI/2;left.position.set(-52,-0.07,0);group.add(left);
      const right = new THREE.Mesh(sand,sandMat);
      right.rotation.x=-Math.PI/2;right.position.set(52,-0.07,0);group.add(right);
      const sea = new THREE.Mesh(ocean,waterMat);
      sea.rotation.x=-Math.PI/2;sea.position.set(140,-0.09,0);group.add(sea);
      for (let n=0;n<7;n++) {
        const z=-42+n*14;
        for (const side of [-1,1]) {
          const x=side*(16+(n%3)*3);
          const palm=new THREE.Group();
          const stem=new THREE.Mesh(trunk,trunkMat);
          stem.position.y=3.5;stem.rotation.z=side*0.08;palm.add(stem);
          for(let k=0;k<7;k++){
            const frond=new THREE.Mesh(leaf,leafMat);
            frond.position.set(Math.cos(k*Math.PI*2/7)*1.8,7.7,Math.sin(k*Math.PI*2/7)*1.8);
            frond.rotation.z=Math.PI/2-0.26;
            frond.rotation.y=k*Math.PI*2/7;
            frond.scale.set(0.42,0.9,0.7);
            palm.add(frond);
          }
          palm.position.set(x,0,z+(logicalIndex%2)*2);
          group.add(palm);
        }
      }
      this.segments.push(group);
      this.segmentIndices.push(index);
      this.object.add(group);
    }
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
