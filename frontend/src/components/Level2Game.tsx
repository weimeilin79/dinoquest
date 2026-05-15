import React, { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Volume2, VolumeX, ArrowLeft, Trophy } from 'lucide-react';

interface Level2GameProps {
  dinoType: "Speedy" | "Tank" | "Balanced" | "Agile" | string;
  dinoImage: string;
  onBack: () => void;
  onLevel2Start?: () => void;
  onLevel2End?: (won: boolean, score: number, hits: number, timeLived: number) => void;
}

interface Rock {
  x: number;
  y: number;
  radius: number;
  speed: number;
  color: string;
  isLava: boolean;
  hp: number;
}

interface Projectile {
  x: number;
  y: number;
  width: number;
  height: number;
  dx: number;
  dy: number;
  angle: number;
  // Pre-computed offset from ellipse center to its start point (rx * cos/sin(angle)).
  // Used for ctx.moveTo before each ctx.ellipse in batched draws — without this,
  // canvas draws connecting lines between consecutive ellipses, creating triangles.
  eSDX: number;
  eSDY: number;
  isShockwave?: boolean;
  damage?: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

const LEVEL_DURATION = 12;

export const Level2Game: React.FC<Level2GameProps> = ({ dinoType, dinoImage, onBack, onLevel2Start, onLevel2End }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isWon, setIsWon] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const [lives, setLives] = useState(1);
  const [timeLeft, setTimeLeft] = useState(LEVEL_DURATION);
  const [score, setScore] = useState(0);
  const [rocksDestroyed, setRocksDestroyed] = useState(0);

  // Abilities
  const isTank = dinoType === 'Tank';
  const isSpeedy = dinoType === 'Speedy';
  const isBalanced = dinoType === 'Balanced';
  const isAgile = dinoType === 'Agile';

  // Audio refs
  const bgMusic = useRef<HTMLAudioElement | null>(null);
  const hitSound = useRef<HTMLAudioElement | null>(null);
  const shootSound = useRef<HTMLAudioElement | null>(null);
  const rockBreakSound = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    bgMusic.current = new Audio('track1.mp3');
    bgMusic.current.loop = true;
    bgMusic.current.volume = 0.2;

    hitSound.current = new Audio('bump.mp3');
    hitSound.current.volume = 0.4;

    shootSound.current = new Audio('jump.mp3');
    shootSound.current.volume = 0.2;

    rockBreakSound.current = new Audio('coin.wav');
    rockBreakSound.current.volume = 0.3;

    return () => {
      if (bgMusic.current) {
        bgMusic.current.pause();
        bgMusic.current = null;
      }
    };
  }, []);

  // Win/Lose sounds
  useEffect(() => {
    if (isWon) {
      const audio = new Audio('win.wav');
      audio.volume = 0.5;
      if (!isMuted) audio.play().catch(() => { });
    } else if (isGameOver) {
      const audio = new Audio('lose.wav');
      audio.volume = 0.5;
      if (!isMuted) audio.play().catch(() => { });
    }
  }, [isWon, isGameOver, isMuted]);

  useEffect(() => {
    if (bgMusic.current) bgMusic.current.muted = isMuted;
    if (hitSound.current) hitSound.current.muted = isMuted;
    if (shootSound.current) shootSound.current.muted = isMuted;
    if (rockBreakSound.current) rockBreakSound.current.muted = isMuted;
  }, [isMuted]);

  useEffect(() => {
    if (gameStarted && !isGameOver && !isWon) {
      bgMusic.current?.play().catch(() => { });
    } else {
      bgMusic.current?.pause();
    }
  }, [gameStarted, isGameOver, isWon]);

  useEffect(() => {
    if (!gameStarted || isGameOver || isWon) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animationFrameId: number;
    let localTime = LEVEL_DURATION;
    let lastTime = performance.now();
    let currentLives = 1;

    let localScore = 0;
    let localRocksDestroyed = 0;

    let isFlickering = false;
    let flickerTimer = 0;

    // --- GAME CONFIG (Standardized for all) ---    
    const paddleWidth = 60;
    const paddleHeight = 60;

    const player = {
      x: canvas.width / 2 - paddleWidth / 2,
      y: canvas.height - paddleHeight - 60,
      width: paddleWidth,
      height: paddleHeight,
      hitboxW: paddleWidth,
      hitboxH: paddleHeight,
      speed: 10, // Standard speed for everyone
      targetX: canvas.width / 2 - paddleWidth / 2 // Used for touch dragging
    };

    const rocks: Rock[] = [];
    const projectiles: Projectile[] = [];
    const floatingTexts: FloatingText[] = [];

    // Background particles
    const ashParticles = Array.from({ length: 20 }).map(() => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      speed: 1 + Math.random() * 2,
      size: Math.random() * 3
    }));

    let lastFireTime = 0;

    const fireWaterBlast = () => {
      const now = performance.now();

      // Dynamic Cooldowns based on weapon power
      let cooldown = 300;
      if (isTank) cooldown = 1300;       // Massive blast -> Longest cooldown (1.3s)
      else if (isAgile) cooldown = 1100;  // Spread shot -> Slower cooldown (1.1s)
      else if (isSpeedy) cooldown = 150; // Machine gun -> Very fast cooldown (0.15s)
      else if (isBalanced) cooldown = 280; // Piercing beam -> Medium-fast cooldown (0.28s)

      if (now - lastFireTime < cooldown) return;
      lastFireTime = now;

      // Only call play() when sound is not already playing — rapid fires (Speedy) would
      // otherwise hammer the mobile audio pipeline with 6-7 play() requests per second
      const snd = shootSound.current;
      if (snd && snd.paused) snd.play().catch(() => {});

      const centerX = player.x + player.width / 2;

      if (isBalanced) {
        projectiles.push({
          x: centerX - 10, y: player.y, width: 20, height: 40, dx: 0, dy: -14,
          angle: 0, eSDX: 10, eSDY: 0
        });
      } else if (isTank) {
        projectiles.push({
          x: 0, y: player.y - 10, width: 400, height: 25, dx: 0, dy: -10,
          angle: 0, eSDX: 200, eSDY: 0, isShockwave: true
        });
      } else if (isSpeedy) {
        if (projectiles.length >= 8) return;
        projectiles.push({
          x: player.x + 5, y: player.y, width: 12, height: 25, dx: 0, dy: -20,
          angle: 0, eSDX: 6, eSDY: 0, damage: 1
        });
        projectiles.push({
          x: player.x + player.width - 17, y: player.y, width: 12, height: 25, dx: 0, dy: -20,
          angle: 0, eSDX: 6, eSDY: 0, damage: 1
        });
      } else if (isAgile) {
        const a1 = 0;
        const a2 = Math.atan2(-10, -4) + Math.PI / 2;
        const a3 = Math.atan2(-10, 4) + Math.PI / 2;
        const rx = 6; // width/2 = 12/2
        projectiles.push({
          x: centerX - 6, y: player.y, width: 12, height: 20, dx: 0, dy: -12,
          angle: a1, eSDX: rx, eSDY: 0
        });
        projectiles.push({
          x: centerX - 6, y: player.y, width: 12, height: 20, dx: -4, dy: -10,
          angle: a2, eSDX: rx * Math.cos(a2), eSDY: rx * Math.sin(a2)
        });
        projectiles.push({
          x: centerX - 6, y: player.y, width: 12, height: 20, dx: 4, dy: -10,
          angle: a3, eSDX: rx * Math.cos(a3), eSDY: rx * Math.sin(a3)
        });
      } else {
        projectiles.push({
          x: centerX - 10, y: player.y, width: 20, height: 40, dx: 0, dy: -12,
          angle: 0, eSDX: 10, eSDY: 0
        });
      }
    };

    const dinoImg = new Image();
    dinoImg.src = dinoImage;

    // Controls
    let rightPressed = false;
    let leftPressed = false;
    let spacePressed = false;
    let screenPressed = false;

    const keyDownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Right' || e.key === 'ArrowRight') rightPressed = true;
      if (e.key === 'Left' || e.key === 'ArrowLeft') leftPressed = true;

      // Fire water blast
      if (e.key === ' ' || e.key === 'Spacebar') {
        spacePressed = true;
        fireWaterBlast();
      }
    };

    const keyUpHandler = (e: KeyboardEvent) => {
      if (e.key === 'Right' || e.key === 'ArrowRight') rightPressed = false;
      if (e.key === 'Left' || e.key === 'ArrowLeft') leftPressed = false;
      if (e.key === ' ' || e.key === 'Spacebar') spacePressed = false;
    };

    window.addEventListener('keydown', keyDownHandler, false);
    window.addEventListener('keyup', keyUpHandler, false);

    // Mouse/Touch controls
    const pointerMoveHandler = (e: MouseEvent | TouchEvent) => {
      let clientX = 0;
      if (e instanceof MouseEvent) {
        clientX = e.clientX;
      } else if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
      }

      const relativeX = clientX - canvasRect.left;

      if (relativeX > 0 && relativeX < canvas.width) {
        player.targetX = relativeX - player.width / 2;
      }
    };

    const pointerDownHandler = (e: MouseEvent | TouchEvent) => {
      let clientY = 0;
      if (e instanceof MouseEvent) {
        clientY = e.clientY;
      } else if (e.touches && e.touches.length > 0) {
        clientY = e.touches[0].clientY;
      }

      const relativeY = clientY - canvasRect.top;

      // Tap anywhere above the player allows shooting
      if (relativeY < canvas.height - 100) {
        screenPressed = true;
        fireWaterBlast();
      }
    };

    const pointerUpHandler = () => {
      screenPressed = false;
    };

    // Prevent default touch moves to avoid scrolling while dodging
    const preventScroll = (e: TouchEvent) => { e.preventDefault(); };

    canvas.addEventListener('mousemove', pointerMoveHandler, false);
    canvas.addEventListener('touchmove', pointerMoveHandler, { passive: false });
    canvas.addEventListener('touchmove', preventScroll, { passive: false });
    canvas.addEventListener('mousedown', pointerDownHandler);
    canvas.addEventListener('touchstart', pointerDownHandler);
    window.addEventListener('mouseup', pointerUpHandler);
    window.addEventListener('touchend', pointerUpHandler);

    // Pre-build gradients once — recreating them every frame is expensive on mobile
    const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    skyGrad.addColorStop(0, '#1a0000');
    skyGrad.addColorStop(0.5, '#4d0000');
    skyGrad.addColorStop(1, '#ff3300');

    const craterGrad = ctx.createRadialGradient(200, canvas.height - 345, 10, 200, canvas.height - 350, 60);
    craterGrad.addColorStop(0, 'rgba(255, 255, 0, 1)');
    craterGrad.addColorStop(0.5, 'rgba(255, 69, 0, 0.8)');
    craterGrad.addColorStop(1, 'rgba(255, 0, 0, 0)');

    // Cache bounding rect — getBoundingClientRect forces reflow if called on every touchmove
    let canvasRect = canvas.getBoundingClientRect();
    const onResize = () => { canvasRect = canvas.getBoundingClientRect(); };
    window.addEventListener('resize', onResize);

    let frameCount = 0;
    let facingLeft = false;

    // Difficulty curve (12s total)
    const getSpawnRate = (timeRem: number) => {
      if (timeRem > 10) return 40;
      if (timeRem > 5) return 28;
      return 18; // Final 5 seconds is intense
    };

    const loop = (timestamp: number) => {
      const deltaTime = (timestamp - lastTime) / 1000;
      lastTime = timestamp;

      localTime -= deltaTime;
      localScore += deltaTime * 20; // Points for dodging/surviving

      if ((spacePressed || screenPressed) && isSpeedy) {
        fireWaterBlast();
      }

      if (Math.ceil(localTime) !== timeLeft) {
        setTimeLeft(Math.max(0, Math.ceil(localTime)));
      }
      if (frameCount % 20 === 0) {
        setScore(Math.floor(localScore));
      }

      if (localTime <= 0) {
        setIsWon(true);
        if (onLevel2End) onLevel2End(true, Math.floor(localScore), localRocksDestroyed, LEVEL_DURATION);
        return;
      }

      if (isFlickering) {
        flickerTimer -= deltaTime;
        if (flickerTimer <= 0) isFlickering = false;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // === BACKGROUND ===
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Back mountain range
      ctx.fillStyle = '#0f0000';
      ctx.beginPath();
      ctx.moveTo(0, canvas.height);
      ctx.lineTo(50, canvas.height - 180);
      ctx.lineTo(80, canvas.height - 150);
      ctx.lineTo(150, canvas.height - 250);
      ctx.lineTo(220, canvas.height - 120);
      ctx.lineTo(300, canvas.height - 280);
      ctx.lineTo(350, canvas.height - 220);
      ctx.lineTo(canvas.width, canvas.height - 300);
      ctx.lineTo(canvas.width, canvas.height);
      ctx.fill();

      // Main Volcano Silhouette
      ctx.fillStyle = '#1f0000';
      ctx.beginPath();
      ctx.moveTo(60, canvas.height);
      ctx.lineTo(170, canvas.height - 350);
      ctx.lineTo(230, canvas.height - 350);
      ctx.lineTo(340, canvas.height);
      ctx.fill();

      // Main Volcano crater glow
      ctx.fillStyle = craterGrad;
      ctx.beginPath();
      ctx.ellipse(200, canvas.height - 350, 40, 15, 0, 0, Math.PI * 2);
      ctx.fill();

      // Magma rivers down the main volcano
      ctx.strokeStyle = '#ff4500';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(180, canvas.height - 340);
      ctx.quadraticCurveTo(160, canvas.height - 250, 120, canvas.height - 150);
      ctx.moveTo(220, canvas.height - 340);
      ctx.quadraticCurveTo(240, canvas.height - 200, 260, canvas.height - 50);
      ctx.stroke();

      // Animated ground wave (Lava Floor) — 40px step keeps the wave smooth while halving sin calls
      ctx.fillStyle = '#ff1a00';
      ctx.beginPath();
      ctx.moveTo(0, canvas.height);
      for (let w = 0; w <= canvas.width; w += 40) {
        ctx.lineTo(w, canvas.height - 60 + Math.sin(frameCount * 0.1 + w * 0.05) * 8);
      }
      ctx.lineTo(canvas.width, canvas.height);
      ctx.fill();

      ctx.fillStyle = '#ff8800';
      ctx.beginPath();
      ctx.moveTo(0, canvas.height);
      for (let w = 0; w <= canvas.width; w += 40) {
        ctx.lineTo(w, canvas.height - 45 + Math.sin(frameCount * 0.15 + w * 0.08) * 8);
      }
      ctx.lineTo(canvas.width, canvas.height);
      ctx.fill();

      // Ash particles
      ctx.fillStyle = 'rgba(100, 100, 100, 0.6)';
      ashParticles.forEach(ash => {
        ash.y += ash.speed;
        if (ash.y > canvas.height) {
          ash.y = 0;
          ash.x = Math.random() * canvas.width;
        }
        ctx.beginPath();
        ctx.arc(ash.x, ash.y, ash.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // Spawn falling rocks
      if (frameCount % getSpawnRate(localTime) === 0) {
        const isLava = Math.random() > 0.7; // 30% chance for special hot lava rock
        rocks.push({
          x: Math.random() * (canvas.width - 20) + 10,
          y: -30,
          radius: 15 + Math.random() * 20, // 15 to 35px radius
          speed: 4 + Math.random() * 5 + (LEVEL_DURATION - localTime) * 0.2, // Speeds up rapidly over time
          color: isLava ? '#ff3300' : '#4a4a4a',
          isLava,
          hp: 2 // Two hits base HP!
        });
      }

      // Draw and update player
      if (rightPressed && player.x < canvas.width - player.width) {
        player.x += player.speed;
        player.targetX = player.x;
      } else if (leftPressed && player.x > 0) {
        player.x -= player.speed;
        player.targetX = player.x;
      } else {
        // Smoothly interpolate towards targetX for touch/mouse
        const diff = player.targetX - player.x;
        if (Math.abs(diff) > player.speed) {
          player.x += Math.sign(diff) * player.speed;
        } else {
          player.x = player.targetX;
        }
        // Bounds clamping
        if (player.x < 0) player.x = 0;
        if (player.x > canvas.width - player.width) player.x = canvas.width - player.width;
      }

      if (!isFlickering || frameCount % 10 < 5) {
        if (dinoImg.complete && dinoImg.naturalHeight > 0) {
          const aspectRatio = dinoImg.naturalWidth / dinoImg.naturalHeight;
          const drawWidth = player.height * aspectRatio;
          const drawX = player.x + (player.width - drawWidth) / 2;

          ctx.save();
          ctx.translate(drawX + drawWidth / 2, player.y + player.height / 2);

          const moveDiff = player.targetX - player.x;
          const isMovingRight = rightPressed || moveDiff > 3;
          const isMovingLeft = leftPressed || moveDiff < -3;
          const justFired = performance.now() - lastFireTime < 180;

          if (isMovingRight) {
            facingLeft = false;
            ctx.rotate(0.12);
          } else if (isMovingLeft) {
            facingLeft = true;
            ctx.rotate(-0.12);
          } else {
            ctx.translate(0, Math.abs(Math.sin(frameCount * 0.1)) * 2);
          }

          // Flip horizontally when facing left — applied after rotation so the
          // lean direction stays correct relative to direction of travel
          if (facingLeft) ctx.scale(-1, 1);

          if (justFired) {
            ctx.scale(1.08, 0.92);
          }

          ctx.drawImage(dinoImg, -drawWidth / 2, -player.height / 2, drawWidth, player.height);
          ctx.restore();
        } else {
          ctx.fillStyle = 'green';
          ctx.fillRect(player.x, player.y, player.width, player.height);
        }
      }

      // Update projectile positions and remove off-screen ones
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        p.x += p.dx;
        p.y += p.dy;
        if ((p.isShockwave && p.y < canvas.height * 0.35) ||
            p.y + p.height < 0 || p.x < 0 || p.x > canvas.width) {
          projectiles.splice(i, 1);
        }
      }

      // Batch draw all projectile bodies in one GPU call
      if (projectiles.length > 0) {
        ctx.fillStyle = 'rgba(0, 191, 255, 0.8)';
        ctx.beginPath();
        for (let i = 0; i < projectiles.length; i++) {
          const p = projectiles[i];
          const cx = p.x + p.width / 2, cy = p.y + p.height / 2;
          // moveTo the ellipse's own start point so canvas doesn't draw a connecting
          // line from the previous ellipse's end point to this one (which causes triangles)
          ctx.moveTo(cx + p.eSDX, cy + p.eSDY);
          ctx.ellipse(cx, cy, p.width / 2, p.height / 2, p.angle, 0, Math.PI * 2);
        }
        ctx.fill();

        // Batch draw all non-shockwave trails in one GPU call
        ctx.fillStyle = 'rgba(0, 255, 255, 0.5)';
        ctx.beginPath();
        for (let i = 0; i < projectiles.length; i++) {
          const p = projectiles[i];
          if (p.isShockwave) continue;
          if (p.width > 30) {
            ctx.moveTo(p.x + 10 + 4, p.y + p.height + 5);
            ctx.arc(p.x + 10, p.y + p.height + 5, 4, 0, Math.PI * 2);
            ctx.moveTo(p.x + p.width - 10 + 4, p.y + p.height + 5);
            ctx.arc(p.x + p.width - 10, p.y + p.height + 5, 4, 0, Math.PI * 2);
            ctx.moveTo(p.x + p.width / 2 + 6, p.y + p.height + 8);
            ctx.arc(p.x + p.width / 2, p.y + p.height + 8, 6, 0, Math.PI * 2);
          } else {
            ctx.moveTo(p.x + p.width / 2 - 3 + 3, p.y + p.height + 4);
            ctx.arc(p.x + p.width / 2 - 3, p.y + p.height + 4, 3, 0, Math.PI * 2);
            ctx.moveTo(p.x + p.width / 2 + 3 + 2, p.y + p.height + 2);
            ctx.arc(p.x + p.width / 2 + 3, p.y + p.height + 2, 2, 0, Math.PI * 2);
          }
        }
        ctx.fill();

        // Shockwave trail (Tank only, rare)
        for (let i = 0; i < projectiles.length; i++) {
          const p = projectiles[i];
          if (!p.isShockwave) continue;
          ctx.fillStyle = 'rgba(0, 255, 255, 0.5)';
          ctx.beginPath();
          for (let w = 20; w < canvas.width; w += 40) {
            ctx.arc(w, p.y + p.height + Math.random() * 10, 4, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      }

      // Update and Draw Rocks
      for (let i = rocks.length - 1; i >= 0; i--) {
        const rock = rocks[i];
        rock.y += rock.speed;

        ctx.fillStyle = rock.color;
        ctx.beginPath();
        ctx.arc(rock.x, rock.y, rock.radius, 0, Math.PI * 2);
        ctx.fill();

        if (rock.isLava) {
          // Glow ring
          ctx.strokeStyle = 'rgba(255, 69, 0, 0.6)';
          ctx.lineWidth = 6;
          ctx.stroke();
        } else {
          // Crags
          ctx.fillStyle = '#222';
          ctx.beginPath();
          ctx.arc(rock.x - rock.radius / 3, rock.y - rock.radius / 3, rock.radius / 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // Projectile hit Rock
        let rockDestroyed = false;
        for (let j = projectiles.length - 1; j >= 0; j--) {
          const p = projectiles[j];
          if (p.x < rock.x + rock.radius && p.x + p.width > rock.x - rock.radius &&
            p.y < rock.y + rock.radius && p.y + p.height > rock.y - rock.radius) {

            rock.hp -= (p.damage || 2);
            if (!isBalanced && !p.isShockwave) projectiles.splice(j, 1); // Balanced and Tank wave pierce!

            if (rock.hp <= 0) {
              rocks.splice(i, 1);
              rockBreakSound.current?.play().catch(() => { });

              localRocksDestroyed += 1;
              localScore += rock.isLava ? 100 : 50;
              setRocksDestroyed(localRocksDestroyed);
              setScore(Math.floor(localScore));

              floatingTexts.push({
                x: rock.x,
                y: rock.y,
                text: rock.isLava ? "+100" : "+50",
                color: rock.isLava ? "255, 215, 0" : "255, 255, 255", // Gold for lava, White for normal
                life: 1.0 // lives for 1 second
              });
              rockDestroyed = true;
              break; // Rock is dead, stop checking projectiles for this rock
            } else {
              // Visual cue: rock gets chipped/shrunk
              rock.radius = Math.max(10, rock.radius * 0.75);
              hitSound.current?.play().catch(() => { });
            }
          }
        }
        if (rockDestroyed) continue;

        // Player Hit Rock
        const playerHitboxX = player.x + (player.width - player.hitboxW) / 2;
        const playerHitboxY = player.y + (player.height - player.hitboxH) / 2;

        // Simple circle-AABB collision estimation
        let testX = rock.x;
        let testY = rock.y;

        if (rock.x < playerHitboxX) testX = playerHitboxX;
        else if (rock.x > playerHitboxX + player.hitboxW) testX = playerHitboxX + player.hitboxW;
        if (rock.y < playerHitboxY) testY = playerHitboxY;
        else if (rock.y > playerHitboxY + player.hitboxH) testY = playerHitboxY + player.hitboxH;

        const distX = rock.x - testX;
        const distY = rock.y - testY;
        const distance = Math.sqrt((distX * distX) + (distY * distY));

        if (distance <= rock.radius && !isFlickering) {
          hitSound.current?.play().catch(() => { });
          rocks.splice(i, 1);
          isFlickering = true;
          flickerTimer = 1.0;

          currentLives--;
          setLives(currentLives);
          if (currentLives <= 0) {
            setIsGameOver(true);
            if (onLevel2End) onLevel2End(false, Math.floor(localScore), localRocksDestroyed, Math.max(0, LEVEL_DURATION - localTime));
            return;
          }
          continue;
        }

        if (rock.y - rock.radius > canvas.height) {
          rocks.splice(i, 1);
        }
      }

      // Update and Draw Floating Texts
      if (floatingTexts.length > 0) {
        ctx.font = "900 24px 'Inter', sans-serif";
        ctx.lineWidth = 2;
        for (let i = floatingTexts.length - 1; i >= 0; i--) {
          const ft = floatingTexts[i];
          ft.life -= deltaTime;
          ft.y -= 40 * deltaTime;

          if (ft.life <= 0) {
            floatingTexts.splice(i, 1);
          } else {
            const alpha = Math.max(0, ft.life);
            ctx.fillStyle = `rgba(${ft.color}, ${alpha})`;
            ctx.fillText(ft.text, ft.x - 20, ft.y);
            ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
            ctx.strokeText(ft.text, ft.x - 20, ft.y);
          }
        }
      }

      frameCount++;
      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('keydown', keyDownHandler);
      window.removeEventListener('keyup', keyUpHandler);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('mousemove', pointerMoveHandler);
      canvas.removeEventListener('touchmove', pointerMoveHandler);
      canvas.removeEventListener('touchmove', preventScroll);
      canvas.removeEventListener('mousedown', pointerDownHandler);
      canvas.removeEventListener('touchstart', pointerDownHandler);
      window.removeEventListener('mouseup', pointerUpHandler);
      window.removeEventListener('touchend', pointerUpHandler);
    };

  }, [gameStarted, isGameOver, isWon, dinoImage, dinoType]);

  if (isGameOver) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center w-full max-w-md mx-auto"
      >
        <div className="inline-block p-6 sm:p-8 rounded-full mb-6 sm:mb-8 shadow-2xl rotate-3 bg-red-400">
          <Trophy size={48} className="text-red-900 sm:w-16 sm:h-16" />
        </div>
        <h2 className="text-4xl sm:text-5xl font-black mb-2 text-red-900">
          GAME OVER
        </h2>
        <p className="text-gray-500 font-bold mb-6 sm:mb-10 text-lg">
          You got crushed by the falling magma!
        </p>
        <div className="flex justify-center gap-2 sm:gap-4 mb-10 w-full">
          <div className="bg-white p-3 sm:p-4 rounded-3xl shadow-lg border-2 border-green-100 flex-1 flex flex-col items-center">
            <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Time</span>
            <span className="text-xl sm:text-2xl font-black text-green-600">{LEVEL_DURATION - timeLeft}s</span>
          </div>
          <div className="bg-white p-3 sm:p-4 rounded-3xl shadow-lg border-2 border-blue-100 flex-1 flex flex-col items-center">
            <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Hits</span>
            <span className="text-xl sm:text-2xl font-black text-blue-600">{rocksDestroyed}</span>
          </div>
          <div className="bg-white p-3 sm:p-4 rounded-3xl shadow-lg border-2 border-yellow-100 flex-1 flex flex-col items-center">
            <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Score</span>
            <span className="text-xl sm:text-2xl font-black text-yellow-600">{Math.floor(score)}</span>
          </div>
        </div>

        <button
          onClick={() => {
            setLives(1);
            setTimeLeft(LEVEL_DURATION);
            setScore(0);
            setRocksDestroyed(0);
            setIsGameOver(false);
            setGameStarted(true);
            if (onLevel2Start) onLevel2Start();
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 sm:py-5 rounded-2xl font-black text-xl flex items-center justify-center gap-3 w-full shadow-lg shadow-blue-200 transition-all hover:-translate-y-1"
        >
          <Play size={24} fill="white" /> TRY AGAIN
        </button>
        <button
          onClick={onBack}
          className="mt-6 text-gray-500 font-bold hover:text-gray-800 transition-colors block mx-auto"
        >
          Return to Menu
        </button>
      </motion.div>
    );
  }

  if (isWon) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center w-full max-w-md mx-auto"
      >
        <div className="inline-block p-6 sm:p-8 rounded-full mb-6 sm:mb-8 shadow-2xl rotate-3 bg-yellow-400">
          <Trophy size={48} className="text-yellow-900 sm:w-16 sm:h-16" />
        </div>
        <h2 className="text-4xl sm:text-5xl font-black mb-2 text-green-900">
          YOU SURVIVED!
        </h2>
        <p className="text-gray-500 font-bold mb-6 sm:mb-10 text-lg">
          You successfully evaded the volcanic eruption!
        </p>
        <div className="flex justify-center gap-2 sm:gap-4 mb-10 w-full">
          <div className="bg-white p-3 sm:p-4 rounded-3xl shadow-lg border-2 border-green-100 flex-1 flex flex-col items-center">
            <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Bonus</span>
            <span className="text-xl sm:text-2xl font-black text-green-600">Survive</span>
          </div>
          <div className="bg-white p-3 sm:p-4 rounded-3xl shadow-lg border-2 border-blue-100 flex-1 flex flex-col items-center">
            <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Hits</span>
            <span className="text-xl sm:text-2xl font-black text-blue-600">{rocksDestroyed}</span>
          </div>
          <div className="bg-white p-3 sm:p-4 rounded-3xl shadow-lg border-2 border-yellow-100 flex-1 flex flex-col items-center">
            <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Score</span>
            <span className="text-xl sm:text-2xl font-black text-yellow-600">{Math.floor(score)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => {
              setLives(1);
              setTimeLeft(LEVEL_DURATION);
              setScore(0);
              setRocksDestroyed(0);
              setIsWon(false);
              setIsGameOver(false);
              setGameStarted(true);
              if (onLevel2Start) onLevel2Start();
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 sm:py-5 rounded-2xl font-black text-xl flex items-center justify-center gap-3 w-full shadow-lg shadow-blue-200 transition-all hover:-translate-y-1"
          >
            <Play size={24} fill="white" /> PLAY AGAIN
          </button>
          <button
            onClick={onBack}
            className="bg-green-600 hover:bg-green-700 text-white px-8 py-4 sm:py-5 rounded-2xl font-black text-xl flex items-center justify-center gap-3 w-full shadow-lg shadow-green-200 transition-all hover:-translate-y-1"
          >
            Return to Menu
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="relative w-full max-w-[400px] aspect-[2/3] mx-auto bg-black rounded-3xl overflow-hidden shadow-2xl border-8 border-orange-600">
      <canvas
        ref={canvasRef}
        width={400}
        height={600}
        className="w-full h-full block"
      />

      {/* Game HUD */}
      {gameStarted && !isWon && !isGameOver && (
        <div className="absolute top-4 left-4 right-4 flex justify-between items-start pointer-events-none z-10">
          <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-2xl border border-white/20 flex flex-col items-center shadow-xl">
            <span className="text-[10px] text-yellow-400 font-bold uppercase tracking-widest leading-none mb-1">Score</span>
            <span className="text-white font-black text-xl leading-none">{Math.floor(score)}</span>
          </div>
          <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-2xl border border-white/20 flex flex-col items-center shadow-xl">
            <span className="text-[10px] text-orange-400 font-bold uppercase tracking-widest leading-none mb-1">Time</span>
            <span className={`font-black text-xl leading-none ${timeLeft <= 5 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{timeLeft}s</span>
          </div>
          <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-2xl border border-white/20 flex flex-col items-center shadow-xl">
            <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest leading-none mb-1">Hits</span>
            <span className="text-white font-black text-xl leading-none">{rocksDestroyed}</span>
          </div>
        </div>
      )}

      {/* Start Overlay */}
      <AnimatePresence>
        {!gameStarted && !isWon && !isGameOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-20"
          >
            <div className="text-center px-4">
              <h3 className="text-orange-500 text-5xl font-black mb-4 tracking-tighter uppercase drop-shadow-[0_0_15px_rgba(234,88,12,0.5)]">VOLCANO DODGE</h3>
              <div className="text-white/80 mb-10 font-bold uppercase tracking-widest text-sm leading-relaxed">
                <span className="text-yellow-300">Drag or Use Arrows to Move.</span><br />
                {isSpeedy && <span className="text-blue-300">Hold Space/Screen for Auto Machine-Gun.<br /></span>}
                {isTank && <span className="text-blue-300">Tap Space/Screen for Huge Shockwaves.<br /></span>}
                {isAgile && <span className="text-blue-300">Tap Space/Screen for Spread Shots.<br /></span>}
                {isBalanced && <span className="text-blue-300">Tap Space/Screen for Piercing Beams.<br /></span>}
                {(!isSpeedy && !isTank && !isAgile && !isBalanced) && <span className="text-blue-300">Tap Space/Screen for Water Blasts.<br /></span>}
                Survive {LEVEL_DURATION} seconds.
              </div>
              <button
                onClick={() => {
                  setGameStarted(true);
                  if (onLevel2Start) onLevel2Start();
                }}
                className="bg-orange-500 hover:bg-orange-600 text-white px-12 py-6 rounded-3xl font-black text-3xl shadow-2xl shadow-orange-500/50 hover:scale-110 transition-all flex items-center gap-4 mx-auto"
              >
                <Play size={40} fill="white" /> START!
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
