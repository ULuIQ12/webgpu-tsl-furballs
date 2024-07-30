
// @ts-nocheck


import { IAnimatedElement } from "../interfaces/IAnimatedElement";
import { color, loop, cond, float, If, instanceIndex, int, min, mix, mx_fractal_noise_float, SpriteNodeMaterial, storage, StorageBufferAttribute, StorageInstancedBufferAttribute, timerDelta, tslFn, uniform, uv, vec3, WebGPURenderer, vec2, sin, cos, MeshStandardNodeMaterial, PI2, gain, timerLocal, step, smoothstep, abs, sub, mul, normalView, normalLocal, normalGeometry, texture, atan2, PI, positionLocal, max, MeshSSSPhysicalNodeMaterial, pow, RGBA_ASTC_4x4_Format, MultiplyBlending, positionWorld, discard } from "three/webgpu";
import { AmbientLight, BufferGeometry, Color, DirectionalLight, DirectionalLightHelper, DirectionalLightShadow, DynamicDrawUsage, EquirectangularReflectionMapping,Group, IcosahedronGeometry, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, Plane, PlaneGeometry, RepeatWrapping, Scene, SpotLight, TextureLoader, Vector3 } from "three/webgpu";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { Root } from "../Root";
import { BufferGeometryUtils, GroundedSkybox, OrbitControls, RGBELoader } from "three/examples/jsm/Addons.js";
import { Pointer } from "../utils/Pointer";
import MeshSSSNodeMaterial from "three/src/nodes/materials/MeshSSSNodeMaterial.js";


export class Furballs implements IAnimatedElement {
	scene: Scene;
	camera: PerspectiveCamera;
	renderer: WebGPURenderer;
	controls: OrbitControls;
	gui: GUI;
	pointerHandler: Pointer;


	constructor(scene: Scene, camera: PerspectiveCamera, controls: OrbitControls, renderer: WebGPURenderer) {
		this.scene = scene;
		this.camera = camera;
		this.controls = controls;
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.1;
		this.camera.position.set(0, 0, 10);
		this.camera.updateMatrixWorld();
		this.renderer = renderer;

		//this.renderer.shadowMap.enabled = true;
		//this.renderer.shadowMap.type = PCFSoftShadowMap;
		this.pointerHandler = new Pointer(this.renderer, this.camera);
		this.pointerHandler.iPlane = new Plane(new Vector3(0, 0, 1), -2.5);
		this.gui = new GUI();
	}

	skyTexture:Texture;
	async init() {

		
		
		

		
		// load the bg / envmap // https://polyhaven.com/a/table_mountain_2_puresky
		//const texture = await new RGBELoader().setPath('./assets/hdr/').loadAsync('table_mountain_2_puresky_2k.hdr', (progress) => {
		const texture = await new RGBELoader().setPath('./assets/hdr/').loadAsync('wide_street_01_2k.hdr', (progress) => {
			//console.log("Skybox load progress", Math.round(progress.loaded / progress.total * 100) + "%");
		});
		texture.mapping = EquirectangularReflectionMapping;
		//this.scene.background = new Color( 0xAA0000);
		//this.scene.background = texture;
		//this.scene.environment = texture;
		const sky:GroundedSkybox = new GroundedSkybox(texture, 3, 100);
		sky.receiveShadow = true;	
		this.scene.add(sky);	
		this.skyTexture = texture;

		await this.initParticles();
		
		// plug the main animation loop
		Root.registerAnimatedElement(this);
		this.createLights();
		this.initGUI();
	}

	uPalette = uniform(0.0);
	palettes = [
		"stray",
		"dark",
		"ginger",
		"black and white",
		"rainbow", 
		"gotta go fast",
	]
	palette = this.palettes[0];

	rotationSpeedX: number = 0.0;
	rotationSpeedY: number = 0.0;
	rotationSpeedZ: number = 0.0;
	rotationOffset:Vector3 = new Vector3(0,0,0);
	initGUI() {

		this.gui.add( this.uTStiffness, 'value', 0.0, 1.0).name('Tendril Stiffness');
		this.gui.add( this.uTDamping, 'value', 0.0, 1.0).name('Tendril Damping');

		this.gui.add( this, 'rotationSpeedX', -8.0, 8.0).name('Rotation Speed X');
		this.gui.add( this, 'rotationSpeedY', -8.0, 8.0).name('Rotation Speed Y');
		this.gui.add( this, 'rotationSpeedZ', -8.0, 8.0).name('Rotation Speed Z');

		this.gui.add( this.uPositionX, 'value', -5.0, 5.0).name('Position X');
		this.gui.add( this.uPositionY, 'value', -5.0, 5.0).name('Position Y');
		this.gui.add( this.uPositionZ, 'value', -5.0, 5.0).name('Position Z');

		this.gui.add( this.uTrendrillLength, 'value', 0.001, 5.0).name('Tendril Length');
		this.gui.add( this.uTendrilBaseRadius, 'value', 0.001, 1.0).name('Tendril Base Radius');
		this.gui.add( this.uTendrilEndRadius, 'value', 0.001, 0.1).name('Tendril End Radius');
		this.gui.add( this.uLenChaos, 'value', 0.0, 1.0).name('Length Chaos');

		this.gui.add( this, 'palette', this.palettes).name('Palette').onChange( (v) => {	
			this.uPalette.value = this.palettes.indexOf(this.palette);
		});
		
	}

	uBallRadius = uniform(float(1.0));
	uIcoDetail = uniform(float(32));

	uRotationX = uniform(float(0.0));
	uRotationY = uniform(float(0.0));
	uRotationZ = uniform(float(0.0));

	uPositionX = uniform(float(0.0));
	uPositionY = uniform(float(0.0));
	uPositionZ = uniform(float(0.0));

	uGravity = uniform( vec3( 0, -0.0981, 0 ) );
	uTrendrillLength = uniform(float(2.0));
	uTendrillSteps = uniform(float(6));
	uTendrilBaseRadius = uniform(float(0.05));
	uTendrilEndRadius = uniform(float(0.005));
	uTendrilRadSegments = uniform(float(5));

	uTStiffness = uniform(float(0.9));
	uTDamping = uniform(float(0.9));

	uLenChaos = uniform(float(0.1));

	uGroundLevel = uniform(float(-3.0));

	basePosGeom:BufferGeometry;
	updateParts;
	updateGeom;
	async initParticles() {

		

		const baseGeom:BufferGeometry = new IcosahedronGeometry( 
			this.uBallRadius.value as unknown as number,
			this.uIcoDetail.value as unknown as number,
		);
		const baseMerged:BufferGeometry = BufferGeometryUtils.mergeVertices(baseGeom);

		const basePosPre = baseMerged.attributes.position;
		const vert:Vector3 = new Vector3();
		const rRange = 0.05;
		for( let i:number = 0 ;i< basePosPre.count; i++) {
			vert.fromBufferAttribute( basePosPre, i );
			const phi:number = Math.atan2( vert.z, vert.x ) + Math.random() * rRange*2 - rRange;
			const theta:number = Math.asin( vert.y )+ Math.random() * rRange*2 - rRange;
			vert.set(
				Math.cos( phi ) * Math.cos( theta ),
				Math.sin( theta ),
				Math.sin( phi ) * Math.cos( theta )				
			);
			basePosPre.setXYZ( i, vert.x, vert.y, vert.z );
		}
		const basePos = basePosPre.clone();
		
		const nbTendrils:number = basePos.count;
		const nbParts:number = nbTendrils * ( this.uTendrillSteps.value as unknown as number);
		this.basePosGeom = baseMerged;
		
		const partPositions = storage( new StorageInstancedBufferAttribute( nbParts, 3), "vec3", nbParts);
		const partVelocities = storage( new StorageInstancedBufferAttribute( nbParts, 3), "vec3", nbParts);
		
		const initPart = tslFn( () => {

			const baseRef = storage( basePos, "vec3", nbTendrils).toReadOnly();
			const iTendril = instanceIndex.div( this.uTendrillSteps );
			
			const root = vec3( baseRef.element( iTendril ) ).rotate( vec3( this.uRotationX, this.uRotationY, this.uRotationZ ) );
			const end = root.add( root.normalize().mul( this.uTrendrillLength ) );
			const step = instanceIndex.remainder( this.uTendrillSteps );
			const pos = mix( root, end, step.toFloat().div( this.uTendrillSteps.sub(1).toFloat() ) );

			partPositions.element( instanceIndex ).xyz.assign( pos );
			partVelocities.element( instanceIndex ).xyz.assign( vec3(0,0,0));

		})().compute(nbParts);
		await this.renderer.computeAsync( initPart );


		this.updateParts = tslFn( () => {
			const position = partPositions.element( instanceIndex ).xyz;
			const velocity = partVelocities.element( instanceIndex ).xyz;
			const baseRef = storage( basePos, "vec3", nbTendrils).toReadOnly();
			const dt = min( 0.3, timerDelta(20) ) ; // big delta at the start, this help stabilize
			const offset = vec3( this.uPositionX, this.uPositionY, this.uPositionZ );
			const iTendril = instanceIndex.div( this.uTendrillSteps );
			const root = vec3( baseRef.element( iTendril ) ).rotate( vec3( this.uRotationX, this.uRotationY, this.uRotationZ ) ).add( offset );

			const tendrilLen = this.uTrendrillLength.add( iTendril.hash().sub(0.5).mul( this.uLenChaos ).mul( this.uTrendrillLength ) );
			const step = instanceIndex.remainder( this.uTendrillSteps );
			const ds = step.toFloat().div(this.uTendrillSteps.sub(1).toFloat());
			const radif = this.uTendrilBaseRadius.sub( this.uTendrilEndRadius );
			const rad = this.uTendrilEndRadius.add(radif.mul(ds.oneMinus() ) );
			const gLev = this.uGroundLevel.add(rad.mul(2));

			If( step.equal(0), () => {
				position.assign( root );
				position.y.maxAssign( gLev );
			}).else( () => {
				const dir = root.sub(offset).normalize();
				const prevPos = partPositions.element( instanceIndex.sub(1) ).xyz;
				const maxDist = tendrilLen.div( this.uTendrillSteps );
				
				
				//const target = prevPos.add( dir.mul( maxDist ) ).toVar();
				//target.y.assign( max( this.uGroundLevel, target.y ) );
				const target = dir.mul( maxDist).toVar();
				

				
				If( prevPos.add( target ).y.lessThanEqual( gLev), () => {
					const dy =  abs( prevPos.add(target).y.sub( gLev ) ).div(maxDist) ;
					target.mulAssign( dy.oneMinus().add(1.0) );
					target.xz.addAssign( prevPos.xz );
					target.y.assign( gLev );

				}).else (() => {
					target.addAssign( prevPos);
				});
				
				
				const diff = target.sub( position ).toVar();
				const acceleration = diff.mul( 
					this.uTStiffness.mul( ds.oneMinus().mul(0.25).add( 0.75 ) ) 
				).sub( velocity.mul( this.uTDamping.mul( ds.mul(0.25).add( 0.75 ) ) ) );

				const pointer = vec3( this.pointerHandler.uPointer );
				const pointerDiff = pointer.sub( position );
				// avoid the pointer
				const distToPointer = pointerDiff.length();
				const pointerDir = pointerDiff.normalize();
				const pointerForce = pointerDir.negate().mul( float(1.0).div( distToPointer.mul(distToPointer).mul(distToPointer).add(0.1) ) );
				acceleration.addAssign( pointerForce);

				acceleration.addAssign( this.uGravity.mul(ds) );

				velocity.addAssign( acceleration.mul(dt) );
				position.addAssign( velocity.mul(dt) );

			});
			
			
		})().compute(nbParts);
		

		/*
		const partMat:SpriteNodeMaterial = new SpriteNodeMaterial();
		partMat.colorNode = color( 0xFF0000);
		partMat.positionNode = partPositions.toAttribute();
		const partGeom:BufferGeometry = new PlaneGeometry( 0.05, 0.05);
		const partMesh:InstancedMesh = new InstancedMesh( partGeom, partMat, nbParts);
		partMesh.instanceMatrix.setUsage( DynamicDrawUsage);
		partMesh.frustumCulled = false;
		*/
		//this.scene.add(partMesh);
		
		const vertPerSteps = (this.uTendrilRadSegments.value as unknown as number) * 6;
		const nbVertTendrils:number = nbTendrils * (this.uTendrillSteps.value as unknown as number) * (vertPerSteps);
		const nbFaces:number = nbVertTendrils / 3 ;
		
		const tendrilVerts:StorageBufferAttribute = new StorageBufferAttribute(nbVertTendrils, 4);
		const tendrilNorms:StorageBufferAttribute = new StorageBufferAttribute(nbVertTendrils, 4);
		const tendrilUvs:StorageBufferAttribute = new StorageBufferAttribute(nbVertTendrils, 2);
		const tendrilsIndices:StorageBufferAttribute = new StorageBufferAttribute(nbVertTendrils, 1);
		
		const tendrilsGeom:BufferGeometry = new BufferGeometry();
		tendrilsGeom.setAttribute('position', tendrilVerts);
		tendrilsGeom.setAttribute('normal', tendrilNorms);
		tendrilsGeom.setAttribute('uv', tendrilUvs);
		tendrilsGeom.setAttribute('tIndex', tendrilsIndices);

		const tendrilsMat:MeshStandardNodeMaterial = new MeshStandardNodeMaterial();
		tendrilsMat.envMap = this.skyTexture;
		//tendrilsMat.envMapRotation = Math.PI / 4 ;
		tendrilsMat.roughness = 0.01;
		tendrilsMat.metalness = 0.1;

		
		const catfurTex = await new TextureLoader().loadAsync('./assets/textures/catfur.png');
		catfurTex.wrapS = RepeatWrapping;
		catfurTex.wrapT = RepeatWrapping;

		const tindex = storage( tendrilsIndices, 'float', tendrilsIndices.count).toAttribute();
		const baseRef = storage( basePos, "vec3", nbTendrils).element( tindex);

		tendrilsMat.colorNode = tslFn( () => {
			positionWorld.y.lessThan( this.uGroundLevel ).discard();

			const nbr = baseRef.normalize().mul(0.5).add(0.5);
			const st = vec2( atan2(nbr.z, nbr.x).div(PI),  nbr.y );
			const ocol = vec3(1.0).toVar();
			If( this.uPalette.equal(0), () => {
				
				ocol.xyz = texture( catfurTex, st ).mul( uv().y.oneMinus().remap(0.0, 1.0, 0.5, 1.0) );

			}).elseif( this.uPalette.equal(1), () => {
				ocol.xyz = color( 0x060606);

			}).elseif( this.uPalette.equal(2), () => {
				const n = mx_fractal_noise_float( st.mul(4.0), 1, 2.0, 0.5, 1.0 );
				const v =  this.gain( smoothstep( -0.5, 0.5, n ), 1.2 );
				ocol.xyz = mix( color(0xFF6600), color(0xc69659), v ).mul( uv().y.oneMinus().remap(0.0, 1.0, 0.5, 1.0) );

			}).elseif( this.uPalette.equal(3), () => {
				
				const n = mx_fractal_noise_float( st.mul(10.0), 1, 2.0, 0.5, 0.5 );
				ocol.xyz = this.gain(n, 0.5 ).mul( uv().y.oneMinus().remap(0.0, 1.0, 0.5, 1.0) );

			}).elseif( this.uPalette.equal(4), () => {
				const n = mx_fractal_noise_float( st.mul(5.0), 1, 2.0, 0.5, 1.0 );
				ocol.xyz = color(0xDD0000).hue( n.mul(PI2) );

			}).elseif( this.uPalette.equal(5), () => {
				
				const n = mx_fractal_noise_float( st.mul(1.0), 1, 2.0, 0.5, 1.0 );
				const v =  smoothstep( -0.3, -0.2, n );
				ocol.xyz = mix( color(0xFFFFFF), color(0x0000FF), v ).mul( uv().y.oneMinus().remap(0.0, 1.0, 0.5, 1.0) );
			});
			return ocol;
			
		})();

		const tendrilsMesh:Mesh = new Mesh(tendrilsGeom, tendrilsMat);
		tendrilsMesh.frustumCulled = false;
		tendrilsMesh.castShadow = true;
		tendrilsMesh.receiveShadow = true;
		this.scene.add(tendrilsMesh);

		const initGeom = tslFn( () => {
			const uvs = storage(tendrilUvs, 'vec2', tendrilUvs.count);
			const indices = storage(tendrilsIndices, 'float', tendrilsIndices.count);
			const iTendril = instanceIndex.div( this.uTendrillSteps ); 

			const step = instanceIndex.remainder( this.uTendrillSteps );
			const ds1 = step.toFloat().div(this.uTendrillSteps.sub(1).toFloat()).oneMinus();
			const ds2 = cond(step.equal(this.uTendrillSteps.sub(1)), 0.0,  step.add(1).toFloat().div(this.uTendrillSteps.sub(1).toFloat()).oneMinus() );

			loop({ type: 'uint', start: 0, end: this.uTendrilRadSegments, condition: '<' }, ({ i }) => {

				const u = i.toFloat().div( this.uTendrilRadSegments );
				const pIndex = instanceIndex.mul( vertPerSteps ).add( i.mul(6) );

				indices.element( pIndex ).x.assign( iTendril );
				indices.element( pIndex.add(1) ).x.assign( iTendril );
				indices.element( pIndex.add(2) ).x.assign( iTendril );
				indices.element( pIndex.add(3) ).x.assign( iTendril );
				indices.element( pIndex.add(4) ).x.assign( iTendril );
				indices.element( pIndex.add(5) ).x.assign( iTendril );

				uvs.element( pIndex ).assign( vec2(u,ds1) );
				uvs.element( pIndex.add(1) ).assign( vec2(u,ds1) );
				uvs.element( pIndex.add(2) ).assign( vec2(u,ds2) );
				uvs.element( pIndex.add(3) ).assign( vec2(u,ds1) );
				uvs.element( pIndex.add(4) ).assign( vec2(u,ds2) );
				uvs.element( pIndex.add(5) ).assign( vec2(u,ds2) );

			});

		})().compute(nbParts);
		await this.renderer.computeAsync( initGeom );
		

		// a tube slice per particle
		this.updateGeom = tslFn( () => {

			const positions = storage(tendrilVerts, 'vec4', tendrilVerts.count);
			const normals = storage(tendrilNorms, 'vec4', tendrilNorms.count);
			
			const startPartPos = partPositions.element( instanceIndex ).xyz;
			const endPartPos = cond(
				instanceIndex.remainder(this.uTendrillSteps).equal( int(this.uTendrillSteps).sub(1)),
				startPartPos.add( startPartPos.sub( partPositions.element( instanceIndex.sub(1) ).xyz ).negate() ) , 
				partPositions.element( instanceIndex.add(1) ).xyz,
			);
			const tan = endPartPos.sub( startPartPos ).normalize();
			const norm = vec3(0,1,0).cross( tan ).normalize();
			const binorm = tan.cross( norm ).normalize();

			const step = instanceIndex.remainder( this.uTendrillSteps );
			const ds1 = step.toFloat().div(this.uTendrillSteps.sub(1).toFloat()).oneMinus();
			const ds2 = cond(step.equal(this.uTendrillSteps.sub(1)), 0.0,  step.add(1).toFloat().div(this.uTendrillSteps.sub(1).toFloat()).oneMinus() );

			const p0 = vec3(0,0,0).toVar();
			const p1 = vec3(0,0,0).toVar();
			const p2 = vec3(0,0,0).toVar();
			const p3 = vec3(0,0,0).toVar();
			const n0 = vec3(0,0,0).toVar();
			const n1 = vec3(0,0,0).toVar();

			const radif = this.uTendrilBaseRadius.sub( this.uTendrilEndRadius );
			const rad1 = this.uTendrilEndRadius.add(radif.mul(ds1) );
			const rad2 = this.uTendrilEndRadius.add(radif.mul(ds2) );

			loop({ type: 'uint', start: 0, end: this.uTendrilRadSegments, condition: '<' }, ({ i }) => {

				const u = i.toFloat().div( this.uTendrilRadSegments );
				const angleStart = u.mul( PI2);
				const angleEnd = i.add(1).toFloat().mul( PI2 ).div( this.uTendrilRadSegments );
				const sinecosStart = vec2( sin(angleStart), cos(angleStart) );
				const sinecosEnd = vec2( sin(angleEnd), cos(angleEnd) );
				
				n0.assign( norm.mul(sinecosStart.y).add( binorm.mul(sinecosStart.x) ).normalize() );
				n1.assign( norm.mul(sinecosEnd.y).add( binorm.mul(sinecosEnd.x) ).normalize() );
				
				p0.assign( startPartPos.add( n0.mul(rad1) ) );
				p1.assign( startPartPos.add( n1.mul(rad1) ) );
				p2.assign( endPartPos.add( n1.mul(rad2) ) );
				p3.assign( endPartPos.add( n0.mul(rad2) ) );

				const pIndex = instanceIndex.mul( vertPerSteps ).add( i.mul(6) );
				positions.element( pIndex ).xyz.assign( p0 );
				positions.element( pIndex.add(1) ).xyz.assign( p1 );
				positions.element( pIndex.add(2) ).xyz.assign( p2 );
				positions.element( pIndex.add(3) ).xyz.assign( p0 );
				positions.element( pIndex.add(4) ).xyz.assign( p2 );
				positions.element( pIndex.add(5) ).xyz.assign( p3 );

				normals.element( pIndex ).xyz.assign( n0 );
				normals.element( pIndex.add(1) ).xyz.assign( n1 );
				normals.element( pIndex.add(2) ).xyz.assign( n1 );
				normals.element( pIndex.add(3) ).xyz.assign( n0 );
				normals.element( pIndex.add(4) ).xyz.assign( n1 );
				normals.element( pIndex.add(5) ).xyz.assign( n0 );

			});
			

		})().compute(nbParts);
	}

	dirLight: DirectionalLight;
	createLights() {

		
		this.dirLight = new DirectionalLight(0xffffff, 3);
		this.dirLight.position.set(10,10,10);
		this.dirLight.castShadow = true;
		
		const s: DirectionalLightShadow = this.dirLight.shadow;
		const sCamSize: number = 15;
		s.bias = -0.001;
		s.mapSize.set(2048, 2048);
		s.camera.near = 10.0;
		s.camera.far = 40;
		s.camera.left = -sCamSize;
		s.camera.right = sCamSize;
		s.camera.top = sCamSize;
		s.camera.bottom = -sCamSize;

		this.scene.add(this.dirLight);
		console.log( this.scene, this.dirLight	);

		const groundMat = new MeshStandardNodeMaterial();
		groundMat.blending = MultiplyBlending;
		
		//groundMat.opacity = 0.1;
		groundMat.transparent = true;
		const ground = new Mesh( new PlaneGeometry(100,100), groundMat );
		ground.geometry.rotateX( -Math.PI/2 );
		//ground.position.set(0,this.uGroundLevel.value - 0.1,0);
		ground.position.set(0,this.uGroundLevel.value,0);
		
		ground.receiveShadow = true;
		this.scene.add(ground);


	}

	tempV3:Vector3 = new Vector3();
	update(dt: number, elapsed: number): void {
		if( this.basePosGeom ) {

			this.uRotationX.value += dt * this.rotationSpeedX;
			this.uRotationY.value += dt * this.rotationSpeedY;
			this.uRotationZ.value += dt * this.rotationSpeedZ;
			
			this.renderer.computeAsync( this.updateParts );
			this.renderer.computeAsync( this.updateGeom );

			this.pointerHandler.iPlane.normal.set(0,0,1).applyEuler(this.camera.rotation);
		}
		
	}

	gain = /*#__PURE__*/ tslFn( ( [ x_immutable, k_immutable ] ) => {

		const k = float( k_immutable ).toVar();
		const x = float( x_immutable ).toVar();
		const a = float( mul( 0.5, pow( mul( 2.0, cond( x.lessThan( 0.5 ), x, sub( 1.0, x ) ) ), k ) ) ).toVar();
	
		return cond( x.lessThan( 0.5 ), a, sub( 1.0, a ) );
	
	} ).setLayout( {
		name: 'gain',
		type: 'float',
		inputs: [
			{ name: 'x', type: 'float' },
			{ name: 'k', type: 'float' }
		]
	} );
	

}