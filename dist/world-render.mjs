import * as THREE from './vendor/three.module.min.js';
import {FLOOR,targetAt} from './world-sim.mjs';

/** Anatomical appearance only. Body integration lives in world-sim.mjs. */
export async function createArenaRenderer(canvas){
  let renderer;
  try{
    const response=await fetch('./assets/flybody.json');
    if(!response.ok)throw new Error('Anatomy could not be loaded');
    const anatomy=await response.json();
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setClearColor(0xe9eeeb);renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    const scene=new THREE.Scene();scene.background=new THREE.Color(0xe9eeeb);
    scene.fog=new THREE.Fog(0xe9eeeb,32,65);
    const camera=new THREE.PerspectiveCamera(48,1,.03,100);camera.up.set(0,0,1);
    scene.add(new THREE.HemisphereLight(0xf7fbff,0x78735b,2.3));
    const sun=new THREE.DirectionalLight(0xfff9e7,3.4);sun.position.set(8,-5,15);sun.castShadow=true;
    sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-17,right:17,top:17,bottom:-17,near:.1,far:45});sun.shadow.bias=-.001;scene.add(sun);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(50,50),new THREE.MeshStandardMaterial({color:0xdfe6de,roughness:1}));
    ground.receiveShadow=true;ground.position.z=-.009;scene.add(ground);
    const grid=new THREE.GridHelper(28,14,0xadbeb0,0xc6d1c5);grid.rotation.x=Math.PI/2;grid.position.z=.001;scene.add(grid);
    const pad=new THREE.Mesh(new THREE.RingGeometry(1.4,1.43,80),new THREE.MeshBasicMaterial({color:0x5c8d72,side:THREE.DoubleSide}));pad.position.z=.005;scene.add(pad);
    const perimeter=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-14,-14,.02),new THREE.Vector3(14,-14,.02),new THREE.Vector3(14,14,.02),new THREE.Vector3(-14,14,.02)]),new THREE.LineBasicMaterial({color:0x829a89}));scene.add(perimeter);
    const fly=new THREE.Group(),wings={};scene.add(fly);
    for(const [name,pivot] of Object.entries(anatomy.pivots)){const group=new THREE.Group();group.position.set(...pivot);wings[name]=group;fly.add(group);}
    const materials=new Map();
    for(const part of anatomy.parts){
      const positions=new Float32Array(part.positions),pivot=part.wing?anatomy.pivots[part.wing]:[0,0,0];
      for(let i=0;i<positions.length;i++)positions[i]-=pivot[i%3];
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(part.indices);geometry.computeVertexNormals();
      const key=part.rgba.join(',');
      if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color:new THREE.Color().setRGB(...part.rgba.slice(0,3),THREE.SRGBColorSpace),roughness:.53,metalness:.02,side:THREE.DoubleSide,transparent:part.rgba[3]<1,opacity:part.rgba[3]<1?.56:1,depthWrite:part.rgba[3]===1}));
      const mesh=new THREE.Mesh(geometry,materials.get(key));mesh.castShadow=part.rgba[3]===1;mesh.receiveShadow=true;mesh.name=part.name;
      (part.wing?wings[part.wing]:fly).add(mesh);
    }
    const target=new THREE.Mesh(new THREE.SphereGeometry(1,32,20),new THREE.MeshStandardMaterial({color:0x303e41,roughness:.83}));target.castShadow=true;scene.add(target);
    const pathPoints=new Float32Array(3002*3),pathGeometry=new THREE.BufferGeometry();pathGeometry.setAttribute('position',new THREE.BufferAttribute(pathPoints,3));pathGeometry.setDrawRange(0,0);
    const path=new THREE.Line(pathGeometry,new THREE.LineBasicMaterial({color:0x2c7a5d,transparent:true,opacity:.82}));path.frustumCulled=false;scene.add(path);
    const lift=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(),1,0x348260,.18,.09);
    const thrust=new THREE.ArrowHelper(new THREE.Vector3(1,0,0),new THREE.Vector3(),1,0xbe843e,.18,.09);scene.add(lift,thrust);
    const targetPos=new THREE.Vector3(),look=new THREE.Vector3();let lastWidth=0,lastHeight=0;
    return {mode:'3d',draw(frame,history,options,view='follow'){
      const width=canvas.clientWidth,height=canvas.clientHeight;if(!width||!height)return;
      if(width!==lastWidth||height!==lastHeight){renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();lastWidth=width;lastHeight=height;}
      fly.position.set(frame.x,frame.y,frame.z);
      const speed=Math.hypot(frame.vx,frame.vy),pitch=frame.z>FLOOR+.03?-.06*Math.min(3,speed):0;
      fly.rotation.set(-frame.yawRate*.08,pitch,frame.yaw,'ZYX');
      const power=options.motorConnected?frame.power:0;
      // Nine display cycles per model second, deliberately far below fly wingbeat frequency.
      const flap=Math.sin(frame.t*Math.PI*18)*.72*power;
      wings.wing_left.rotation.x=flap;wings.wing_right.rotation.x=-flap;
      const object=targetAt(frame.t,options.scenario);target.position.set(object.x,object.y,object.z);target.scale.setScalar(object.radius);
      let length=0;for(const f of history){if(f.t>frame.t+1e-9)break;pathPoints[length*3]=f.x;pathPoints[length*3+1]=f.y;pathPoints[length*3+2]=f.z;length++;}
      pathGeometry.attributes.position.needsUpdate=true;pathGeometry.setDrawRange(0,length);
      lift.position.copy(fly.position);lift.position.y+=.65;lift.setLength(Math.max(.001,power*2),.18,.09);lift.visible=power>.03;
      thrust.position.copy(fly.position);thrust.position.z+=.35;thrust.setDirection(new THREE.Vector3(Math.cos(frame.yaw),Math.sin(frame.yaw),0));thrust.setLength(Math.max(.001,power*1.4),.18,.09);thrust.visible=power>.03&&frame.z>FLOOR+.01;
      if(view==='arena'){targetPos.set(18,-21,16);look.set(3,0,2.5);}
      else if(view==='top'){targetPos.set(frame.x,frame.y-.01,frame.z+10);look.set(frame.x,frame.y,frame.z);}
      else if(view==='side'){targetPos.set(frame.x+.3,frame.y-8,frame.z+1.7);look.set(frame.x+.3,frame.y,frame.z+.2);}
      else{targetPos.set(frame.x-5.3,frame.y-3.8,frame.z+3);look.set(frame.x+2,frame.y,frame.z+.3);}
      camera.position.copy(targetPos);camera.lookAt(look);renderer.render(scene,camera);
    }};
  }catch(error){
    renderer?.dispose();
    const replacement=canvas.cloneNode(false);canvas.replaceWith(replacement);
    return createFallback(replacement,error.message);
  }
}

function createFallback(canvas,reason){
  const ctx=canvas.getContext('2d');
  return {mode:'2d',reason,draw(frame,history,options){
    const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;
    const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#e9eeeb';ctx.fillRect(0,0,w,h);
    const scale=Math.min(w,h)/30,x=v=>w/2+v*scale,y=v=>h/2-v*scale;
    ctx.strokeStyle='#c8d4c9';ctx.lineWidth=1;
    for(let i=-14;i<=14;i+=2){ctx.beginPath();ctx.moveTo(x(i),y(-14));ctx.lineTo(x(i),y(14));ctx.moveTo(x(-14),y(i));ctx.lineTo(x(14),y(i));ctx.stroke();}
    ctx.strokeStyle='#2c7a5d';ctx.lineWidth=2;ctx.beginPath();history.filter(f=>f.t<=frame.t).forEach((f,i)=>i?ctx.lineTo(x(f.x),y(f.y)):ctx.moveTo(x(f.x),y(f.y)));ctx.stroke();
    const target=targetAt(frame.t,options.scenario);ctx.fillStyle='#303e41';ctx.beginPath();ctx.arc(x(target.x),y(target.y),target.radius*scale,0,Math.PI*2);ctx.fill();
    ctx.save();ctx.translate(x(frame.x),y(frame.y));ctx.rotate(-frame.yaw);ctx.fillStyle='#176148';ctx.beginPath();ctx.moveTo(10,0);ctx.lineTo(-7,-6);ctx.lineTo(-4,0);ctx.lineTo(-7,6);ctx.closePath();ctx.fill();ctx.restore();
    ctx.font='12px system-ui';ctx.fillStyle='#354f42';ctx.fillText('Top-down position view · 3D anatomy unavailable',20,h-42);
  }};
}
