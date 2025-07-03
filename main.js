import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// --- CONFIGURATION ---
const CONFIG = {
    GRAVITY: -18,
    PLAYER: {
        MOVE_SPEED: 5,
        SPRINT_SPEED: 8,
        JUMP_FORCE: 7,
        CAM_SMOOTHING: 0.1,
        MAX_HEALTH: 100,
        MAX_STAMINA: 100,
        STAMINA_REGEN: 20,
        STAMINA_COSTS: { SPRINT: 30, JUMP: 10, BLOCK: 60, KICK: 25 },
        KICK_FORCE: 600,
        DAMAGE_TAKEN: 20,
        BLOCK_DAMAGE_REDUCTION: 0.8,
    },
    ENEMY: {
        MOVE_SPEED: 4,
        MAX_HEALTH: 100,
        ATTACK_COOLDOWN: 1.5, // in seconds
        ATTACK_RANGE: 3.5,
        CHASE_RANGE: 15,
        ATTACK_FORCE: 12,
        DAMAGE_DEALT: 20,
    },
    SWORD: {
        ARM_STRENGTH: 60,
        BLOCK_ARM_STRENGTH: 120,
        ROTATION_SMOOTHING: 0.2,
        IMPACT_THRESHOLD: 4,
    },
    PHYSICS: {
        FIXED_TIME_STEP: 1 / 60,
    }
};

// --- GAME STATE & SETUP ---
let gameState = 'start';
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');
const healthBar = document.getElementById('health-bar');
const staminaBar = document.getElementById('stamina-bar');

// --- PHYSICS WORLD ---
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, CONFIG.GRAVITY, 0) });
const GROUP_PLAYER = 1, GROUP_ENEMY = 2, GROUP_SWORD_P = 4, GROUP_SWORD_E = 8, GROUP_GROUND = 16;
const groundMaterial = new CANNON.Material("ground");
const charMaterial = new CANNON.Material("character");
const contactMaterial = new CANNON.ContactMaterial(groundMaterial, charMaterial, { friction: 0.1, restitution: 0.0 });
world.addContactMaterial(contactMaterial);

// --- ENVIRONMENT & LIGHTING ---
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(20, 30, 10);
dirLight.castShadow = true;
scene.add(dirLight);

const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0x999999 }));
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

const groundBody = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane(), material: groundMaterial, collisionFilterGroup: GROUP_GROUND, collisionFilterMask: -1 });
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

scene.background = new THREE.CubeTextureLoader().load([
    'https://cdn.glitch.global/e532a89a-53a8-4610-8557-4879a66d3336/px.png', 'https://cdn.glitch.global/e532a89a-53a8-4610-8557-4879a66d3336/nx.png',
    'https://cdn.glitch.global/e532a89a-53a8-4610-8557-4879a66d3336/py.png', 'https://cdn.glitch.global/e532a89a-53a8-4610-8557-4879a66d3336/ny.png',
    'https://cdn.glitch.global/e532a89a-53a8-4610-8557-4879a66d3336/pz.png', 'https://cdn.glitch.global/e532a89a-53a8-4610-8557-4879a66d3336/nz.png'
]);

// --- INPUT CONTROLLER ---
const input = { keys: new Set(), mouse: { x: 0, y: 0, rightClick: false } };
window.addEventListener('keydown', (e) => input.keys.add(e.code));
window.addEventListener('keyup', (e) => input.keys.delete(e.code));
window.addEventListener('mousedown', (e) => { if (e.button === 2) input.mouse.rightClick = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 2) input.mouse.rightClick = false; });
window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement) {
        input.mouse.x += e.movementX;
        input.mouse.y += e.movementY;
    }
});

// --- CHARACTER & SWORD CLASSES ---
class Character {
    constructor(config, startPos, group, color) {
        this.config = config;
        this.health = this.config.MAX_HEALTH;
        this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial({ color }));
        this.mesh.castShadow = true;
        scene.add(this.mesh);
        
        this.body = new CANNON.Body({
            mass: 70, fixedRotation: true, material: charMaterial,
            shape: new CANNON.Box(new CANNON.Vec3(0.5, 1, 0.5)),
            position: new CANNON.Vec3(...startPos),
            collisionFilterGroup: group
        });
        world.addBody(this.body);

        this.previousState = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
        this.storeState();
    }

    takeDamage(amount, sourceBody) {
        this.health = Math.max(0, this.health - amount);
        this.mesh.material.color.set(0xffffff);
        setTimeout(() => this.mesh.material.color.set(this.originalColor), 100);
    }
    
    storeState() {
        this.previousState.position.copy(this.body.position);
        this.previousState.quaternion.copy(this.body.quaternion);
    }

    interpolateState(alpha) {
        this.mesh.position.lerpVectors(this.previousState.position, this.body.position, alpha);
        this.mesh.quaternion.slerpQuaternions(this.previousState.quaternion, this.body.quaternion, alpha);
    }
}

class Player extends Character {
    constructor(startPos) {
        super(CONFIG.PLAYER, startPos, GROUP_PLAYER, 0xeeeeee);
        this.originalColor = 0xeeeeee;
        this.stamina = this.config.MAX_STAMINA;
        this.isBlocking = false;
        this.targetCameraRotation = { x: 0, y: 0 };
        this.sword = new Sword(GROUP_SWORD_P, 0xC0C0C0, this);
        this.mesh.visible = false; // First-person
        this.body.addEventListener("collide", (e) => this.onCollide(e));
    }

    onCollide(e) {
        if (e.body === enemy.sword.body) {
            const impact = e.contact.getImpactVelocityAlongNormal();
            if (Math.abs(impact) > CONFIG.SWORD.IMPACT_THRESHOLD) {
                const damage = CONFIG.ENEMY.DAMAGE_DEALT * (this.isBlocking ? 1 - this.config.BLOCK_DAMAGE_REDUCTION : 1);
                this.takeDamage(damage);
            }
        }
    }

    takeDamage(amount) {
        super.takeDamage(amount);
        if (this.health === 0) endGame(false);
        this.shakeCamera();
    }
    
    shakeCamera() {
        camera.position.x += (Math.random() - 0.5) * 0.2;
    }

    update(deltaTime) {
        this.isBlocking = input.mouse.rightClick && this.stamina > 0;

        // Stamina
        if (!input.keys.has('ShiftLeft') && !this.isBlocking) this.stamina = Math.min(this.config.MAX_STAMINA, this.stamina + this.config.STAMINA_REGEN * deltaTime);
        if (input.keys.has('ShiftLeft')) this.stamina = Math.max(0, this.stamina - this.config.STAMINA_COSTS.SPRINT * deltaTime);
        if (this.isBlocking) this.stamina = Math.max(0, this.stamina - this.config.STAMINA_COSTS.BLOCK * deltaTime);

        // Movement
        const speed = input.keys.has('ShiftLeft') && this.stamina > 0 ? this.config.SPRINT_SPEED : this.config.MOVE_SPEED;
        const moveDir = new THREE.Vector3((input.keys.has('KeyD') ? 1:0)-(input.keys.has('KeyA')?1:0), 0, (input.keys.has('KeyS')?1:0)-(input.keys.has('KeyW')?1:0));
        if (moveDir.lengthSq() > 0) {
            moveDir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.targetCameraRotation.y);
            this.body.velocity.x = moveDir.x * speed;
            this.body.velocity.z = moveDir.z * speed;
        }

        // Jump & Kick (single press actions)
        if (input.keys.has('Space') && this.stamina > this.config.STAMINA_COSTS.JUMP) {
            if (world.raycastClosest(this.body.position, new CANNON.Vec3(this.body.position.x, this.body.position.y - 1.1, this.body.position.z), {})) {
                this.body.velocity.y = this.config.JUMP_FORCE;
                this.stamina -= this.config.STAMINA_COSTS.JUMP;
            }
        }
        if (input.keys.has('KeyF') && this.stamina > this.config.STAMINA_COSTS.KICK) {
            if (this.body.position.distanceTo(enemy.body.position) < 2.5) {
                const kickDir = enemy.body.position.vsub(this.body.position).unit();
                enemy.body.applyImpulse(kickDir.scale(this.config.KICK_FORCE), enemy.body.position);
            }
            this.stamina -= this.config.STAMINA_COSTS.KICK;
        }
        input.keys.delete('Space');
        input.keys.delete('KeyF');
        
        // Camera
        this.targetCameraRotation.y -= input.mouse.x * 0.002;
        this.targetCameraRotation.x -= input.mouse.y * 0.002;
        this.targetCameraRotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.targetCameraRotation.x));
        input.mouse.x = input.mouse.y = 0; // Reset mouse movement

        camera.rotation.y += (this.targetCameraRotation.y - camera.rotation.y) * this.config.CAM_SMOOTHING;
        camera.rotation.x += (this.targetCameraRotation.x - camera.rotation.x) * this.config.CAM_SMOOTHING;
        camera.position.copy(this.body.position).y += 1.8;
        
        this.sword.update(this.isBlocking);
    }
}

class Enemy extends Character {
    constructor(startPos) {
        super(CONFIG.ENEMY, startPos, GROUP_ENEMY, 0xff0000);
        this.originalColor = 0xff0000;
        this.state = 'CHASING';
        this.attackTimer = this.config.ATTACK_COOLDOWN;
        this.sword = new Sword(GROUP_SWORD_E, 0x505050, this);
        this.body.addEventListener("collide", (e) => this.onCollide(e));
    }

    onCollide(e) {
        if (e.body === player.sword.body) {
            const impact = e.contact.getImpactVelocityAlongNormal();
            if (Math.abs(impact) > CONFIG.SWORD.IMPACT_THRESHOLD) {
                this.takeDamage(CONFIG.PLAYER.DAMAGE_TAKEN, player.body);
            }
        }
    }

    takeDamage(amount, sourceBody) {
        super.takeDamage(amount);
        if (this.health === 0) endGame(true);
        const impulseDir = this.body.position.vsub(sourceBody.position).unit();
        this.body.applyImpulse(impulseDir.scale(150), this.body.position);
    }

    update(deltaTime) {
        this.attackTimer -= deltaTime;
        const distance = this.body.position.distanceTo(player.body.position);
        const direction = player.body.position.vsub(this.body.position).unit();
        
        // State Machine
        if (distance < this.config.ATTACK_RANGE) this.state = 'ATTACKING';
        else if (distance < this.config.CHASE_RANGE) this.state = 'CHASING';
        
        switch(this.state) {
            case 'CHASING':
                this.body.velocity.x = direction.x * this.config.MOVE_SPEED;
                this.body.velocity.z = direction.z * this.config.MOVE_SPEED;
                break;
            case 'ATTACKING':
                if (this.attackTimer <= 0) {
                    this.sword.body.velocity.copy(direction.scale(this.config.ATTACK_FORCE));
                    this.attackTimer = this.config.ATTACK_COOLDOWN;
                }
                break;
        }

        const angle = Math.atan2(direction.x, direction.z);
        this.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle);
        this.sword.update();
    }
}

class Sword {
    constructor(group, color, owner) {
        this.owner = owner;
        this.mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.8), new THREE.MeshStandardMaterial({ color }));
        this.mesh.castShadow = true;
        scene.add(this.mesh);
        
        this.body = new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(0.05, 0.05, 0.9)) });
        this.body.collisionFilterGroup = group;
        this.body.collisionFilterMask = -1 ^ group ^ (owner instanceof Player ? GROUP_PLAYER : GROUP_ENEMY);
        world.addBody(this.body);
        
        this.previousState = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
        this.storeState();
    }
    
    storeState() {
        this.previousState.position.copy(this.body.position);
        this.previousState.quaternion.copy(this.body.quaternion);
    }
    
    interpolateState(alpha) {
        this.mesh.position.lerpVectors(this.previousState.position, this.body.position, alpha);
        this.mesh.quaternion.slerpQuaternions(this.previousState.quaternion, this.body.quaternion, alpha);
    }

    update(isBlocking = false) {
        if (this.owner instanceof Player) { // Player sword logic
            const targetPos = new THREE.Vector3();
            const armStrength = isBlocking ? CONFIG.SWORD.BLOCK_ARM_STRENGTH : CONFIG.SWORD.ARM_STRENGTH;
            const offset = isBlocking ? new THREE.Vector3(0.3, -0.1, -1.2) : new THREE.Vector3(0.5, -0.4, -1.5);
            camera.localToWorld(targetPos.copy(offset));
            const force = targetPos.vsub(this.body.position).scale(armStrength);
            this.body.velocity.copy(force);
            
            const targetQuat = new CANNON.Quaternion();
            camera.getWorldQuaternion(targetQuat);
            this.body.quaternion.slerp(targetQuat, CONFIG.SWORD.ROTATION_SMOOTHING, this.body.quaternion);
        } else { // Enemy sword logic
            const offset = new CANNON.Vec3(0, 0.5, 1);
            this.owner.body.quaternion.vmult(offset, offset);
            this.body.position.copy(this.owner.body.position).vadd(offset, this.body.position);
            this.body.quaternion.copy(this.owner.body.quaternion);
        }
    }
}

// --- GAME MANAGEMENT ---
let player, enemy, gameObjects;

function initGame() {
    player = new Player([0, 2, 8]);
    enemy = new Enemy([0, 2, 0]);
    gameObjects = [player, enemy, player.sword, enemy.sword];
}

function resetGame() {
    player.health = player.config.MAX_HEALTH;
    player.stamina = player.config.MAX_STAMINA;
    player.body.position.set(0, 2, 8);
    player.body.velocity.set(0,0,0);
    
    enemy.health = enemy.config.MAX_HEALTH;
    enemy.body.position.set(0, 2, 0);
    enemy.body.velocity.set(0,0,0);
    
    gameState = 'playing';
    hud.style.display = 'block';
    overlay.style.display = 'none';
    renderer.domElement.requestPointerLock();
}

function endGame(playerWon) {
    if (gameState === 'gameOver') return;
    gameState = 'gameOver';
    hud.style.display = 'none';
    overlay.style.display = 'block';
    document.exitPointerLock();
    overlayTitle.innerText = playerWon ? "VICTORY" : "YOU DIED";
    overlayText.innerHTML = (playerWon ? "You have defeated the Red Knight." : "The arena claims another warrior.") + "<br><br><strong class='pulse'>Press ENTER to Play Again</strong>";
}

// --- MAIN LOOP ---
const clock = new THREE.Clock();
let accumulator = 0;
function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();

    if (gameState === 'playing') {
        player.update(deltaTime);
        enemy.update(deltaTime);
        
        accumulator += deltaTime;
        while (accumulator >= CONFIG.PHYSICS.FIXED_TIME_STEP) {
            gameObjects.forEach(obj => obj.storeState());
            world.step(CONFIG.PHYSICS.FIXED_TIME_STEP);
            accumulator -= CONFIG.PHYSICS.FIXED_TIME_STEP;
        }
        
        const alpha = accumulator / CONFIG.PHYSICS.FIXED_TIME_STEP;
        gameObjects.forEach(obj => obj.interpolateState(alpha));

        healthBar.style.width = (player.health / player.config.MAX_HEALTH) * 100 + '%';
        staminaBar.style.width = (player.stamina / player.config.MAX_STAMINA) * 100 + '%';
    }

    renderer.render(scene, camera);
}

// --- INITIALIZE & START ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && (gameState === 'start' || gameState === 'gameOver')) resetGame();
});
window.addEventListener('contextmenu', e => e.preventDefault());

initGame();
animate();
