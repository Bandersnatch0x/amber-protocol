import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import styles from './DataFlowDiagram.module.css';

export const DataFlowDiagram: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current || typeof window === 'undefined') return;

    const canvas = canvasRef.current;
    const width = canvas.parentElement?.clientWidth || 900;
    const height = canvas.parentElement?.clientHeight || 350;

    // Scene & Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.z = 180;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Particle Constellation Geometry
    const particleCount = 120;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    const amberColor = new THREE.Color('#f59e0b');
    const blueColor = new THREE.Color('#3b82f6');

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 400;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 100;

      const isAmber = Math.random() > 0.4;
      const c = isAmber ? amberColor : blueColor;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 3.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.65,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    // Connecting dynamic lines
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.12,
    });
    const lineGeometry = new THREE.BufferGeometry();
    const lineMesh = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(lineMesh);

    let animationFrameId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      const time = clock.getElapsedTime();

      // Rotate particle cloud gently
      particles.rotation.y = time * 0.05;
      particles.rotation.x = Math.sin(time * 0.03) * 0.05;

      const pos = geometry.attributes.position.array as Float32Array;
      const linePositions: number[] = [];

      for (let i = 0; i < particleCount; i++) {
        // Floating wave movement
        pos[i * 3 + 1] += Math.sin(time + pos[i * 3] * 0.01) * 0.12;

        // Form connections between nearby particles
        for (let j = i + 1; j < particleCount; j++) {
          const dx = pos[i * 3] - pos[j * 3];
          const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
          const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < 45) {
            linePositions.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
            linePositions.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
          }
        }
      }

      geometry.attributes.position.needsUpdate = true;
      lineGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(linePositions, 3)
      );

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      if (!canvas.parentElement) return;
      const newWidth = canvas.parentElement.clientWidth;
      const newHeight = canvas.parentElement.clientHeight;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
    };
  }, []);

  return (
    <div className={styles.diagramWrapper}>
      {/* 3D WebGL Canvas Layer */}
      <canvas ref={canvasRef} className={styles.canvasBackground} />

      {/* Foreground Content */}
      <div className={styles.diagramContent}>
        <div className={styles.diagramHeader}>
          <h2 className={styles.diagramTitle}>Governance Engineering for Amber Protocol</h2>
          <div className={styles.diagramSubtitle}>
            THE SYSTEM BEHIND AGENT-ASSISTED GOVERNANCE
          </div>
        </div>

        <div className={styles.flowContainer}>
          {/* 1. User Request Node */}
          <div className={styles.nodeCard}>
            <div className={styles.nodeTitle}>USER REQUEST</div>
            <div className={styles.nodeSubtitle}>goal · inputs · constraints</div>
          </div>

          {/* SVG Connector 1: Straight Arrow */}
          <svg
            className={styles.connectorSvg}
            viewBox="0 0 50 160"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M 5 80 L 45 80"
              className={styles.solidArrow}
              stroke="#3b82f6"
              strokeWidth="2"
            />
            <polygon points="45,76 50,80 45,84" fill="#3b82f6" />
          </svg>

          {/* 2. Branch Stack: RESEARCH, BUILD, VERIFY */}
          <div className={styles.branchStack}>
            <div className={styles.branchNode}>RESEARCH</div>
            <div className={styles.branchNode}>BUILD</div>
            <div className={styles.branchNode}>VERIFY</div>
          </div>

          {/* SVG Connector 2: Curved Merging Dashed Stream */}
          <svg
            className={styles.connectorSvg}
            viewBox="0 0 60 160"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Top branch curve */}
            <path
              d="M 5 28 C 30 28, 40 75, 55 78"
              className={styles.flowLine}
              stroke="#3b82f6"
              strokeWidth="2"
            />
            {/* Middle branch straight */}
            <path
              d="M 5 80 L 55 80"
              className={styles.flowLine}
              stroke="#3b82f6"
              strokeWidth="2"
            />
            {/* Bottom branch curve */}
            <path
              d="M 5 132 C 30 132, 40 85, 55 82"
              className={styles.flowLine}
              stroke="#3b82f6"
              strokeWidth="2"
            />
          </svg>

          {/* 3. Center Kernel: Amber Protocol */}
          <div className={styles.engineBoundary}>
            <div className={styles.engineCard}>
              <div className={styles.engineBeacon} />
              <div className={styles.engineLogo}>
                A<span>.</span>
              </div>
              <div className={styles.engineLabel}>AMBER PROTOCOL</div>
            </div>
          </div>

          {/* SVG Connector 3: Flow Arrow to Synthesize */}
          <svg
            className={styles.connectorSvg}
            viewBox="0 0 50 160"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M 5 80 L 45 80"
              className={styles.solidArrow}
              stroke="#3b82f6"
              strokeWidth="2"
            />
            <polygon points="45,76 50,80 45,84" fill="#3b82f6" />
          </svg>

          {/* 4. Synthesize Node (Oval Pill) */}
          <div className={`${styles.nodeCard} ${styles.pillNode}`}>
            <div className={styles.nodeTitle}>SYNTHESIZE</div>
            <div className={styles.nodeSubtitle}>state + evidence</div>
          </div>

          {/* SVG Connector 4: Flow Arrow to Ship */}
          <svg
            className={styles.connectorSvg}
            viewBox="0 0 50 160"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M 5 80 L 45 80"
              className={styles.solidArrow}
              stroke="#3b82f6"
              strokeWidth="2"
            />
            <polygon points="45,76 50,80 45,84" fill="#3b82f6" />
          </svg>

          {/* 5. Pass -> Ship Node */}
          <div className={styles.nodeCard}>
            <div className={styles.nodeTitle}>PASS → SHIP</div>
            <div className={styles.nodeSubtitle}>bounded output</div>
          </div>
        </div>

        {/* Footer Tagline */}
        <div className={styles.diagramFooter}>
          <div className={styles.tagline}>
            STATE · ROUTING · VERIFICATION · RECOVERY
          </div>
        </div>
      </div>
    </div>
  );
};
