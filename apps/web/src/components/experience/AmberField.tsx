import { useEffect, useRef, useState } from 'react';

type AmberFieldProps = {
  stage: number;
  progress: number;
};

const vertexShaderSource = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform float u_time;
uniform float u_stage;
uniform float u_progress;
uniform float u_motion;

in vec2 v_uv;
out vec4 outColor;

#define PI 3.14159265359

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 spin = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = spin * p * 2.03 + 17.1;
    amplitude *= 0.5;
  }
  return value;
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float ring(vec2 p, vec2 center, float radius, float width) {
  return 1.0 - smoothstep(width, width * 2.5, abs(length(p - center) - radius));
}

vec3 spectral(float t) {
  // Product palette: debug-blue accent on cool graphite — no marketing amber glow.
  vec3 deep = vec3(0.06, 0.10, 0.18);
  vec3 blue = vec3(0.15, 0.39, 0.92);
  vec3 soft = vec3(0.37, 0.55, 0.84);
  return mix(deep, mix(blue, soft, smoothstep(0.35, 0.95, t)), 0.85 + 0.15 * t);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 p = (frag * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  p.x *= aspect > 1.0 ? 1.0 : aspect;

  float time = u_time * u_motion;
  vec2 pointer = (u_pointer * 2.0 - 1.0);
  pointer.x *= u_resolution.x / max(u_resolution.y, 1.0);

  float drift = fbm(p * 1.65 + vec2(time * 0.055, -time * 0.037));
  vec2 warped = p + 0.11 * vec2(
    fbm(p * 2.1 + drift + time * 0.025),
    fbm(p * 2.1 - drift - time * 0.021)
  );

  vec3 color = vec3(0.04, 0.055, 0.09);
  float radial = exp(-length(warped - vec2(0.06, -0.02)) * 1.45);
  color += vec3(0.02, 0.04, 0.09) * radial * 0.55;

  vec2 gridUv = warped * 9.0;
  vec2 gridLine = abs(fract(gridUv - 0.5) - 0.5) / max(fwidth(gridUv), vec2(0.001));
  float grid = 1.0 - min(min(gridLine.x, gridLine.y), 1.0);
  color += vec3(0.12, 0.18, 0.32) * grid * (0.05 + 0.06 * radial);

  vec2 nodes[6];
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float angle = -2.45 + fi * 0.86 + sin(time * 0.12 + fi) * 0.025;
    float radius = 0.60 + 0.055 * sin(fi * 2.3 + time * 0.18);
    nodes[i] = vec2(cos(angle), sin(angle)) * radius + vec2(0.07, -0.02);
  }

  float network = 0.0;
  for (int i = 0; i < 5; i++) {
    float d = sdSegment(warped, nodes[i], nodes[i + 1]);
    float activeMix = smoothstep(float(i) - 0.65, float(i) + 0.35, u_stage);
    network += (1.0 - smoothstep(0.002, 0.012, d)) * (0.12 + activeMix * 0.42);
  }
  float closePath = sdSegment(warped, nodes[5], nodes[0]);
  network += (1.0 - smoothstep(0.002, 0.012, closePath)) * 0.10;
  color += spectral(clamp(u_stage / 5.0, 0.0, 1.0)) * network;

  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float current = 1.0 - smoothstep(0.0, 0.72, abs(fi - u_stage));
    float visited = 1.0 - step(u_stage + 0.45, fi);
    float pulse = 0.5 + 0.5 * sin(time * 2.1 - fi * 0.8);
    float halo = ring(warped, nodes[i], 0.048 + current * 0.016 + pulse * 0.004 * current, 0.005);
    float core = 1.0 - smoothstep(0.012, 0.030, length(warped - nodes[i]));
    vec3 nodeColor = spectral(fi / 5.0);
    color += nodeColor * halo * (0.18 + current * 0.85 + visited * 0.18);
    color += nodeColor * core * (0.18 + current * 0.7);
  }

  float orbitA = ring(warped, vec2(0.07, -0.02), 0.79 + drift * 0.025, 0.0016);
  float orbitB = ring(warped, vec2(0.07, -0.02), 0.93 + drift * 0.02, 0.0012);
  color += vec3(0.14, 0.28, 0.68) * orbitA * 0.28;
  color += vec3(0.55, 0.28, 0.08) * orbitB * 0.18;

  float scanY = fract(v_uv.y * 110.0 + time * 0.35);
  color += vec3(0.05, 0.07, 0.12) * (1.0 - smoothstep(0.0, 0.18, scanY)) * 0.08;

  float cursorGlow = exp(-length(warped - pointer) * 5.2);
  color += spectral(clamp(u_progress, 0.0, 1.0)) * cursorGlow * 0.05;

  float vignette = smoothstep(1.38, 0.18, length(p * vec2(0.78, 0.94)));
  color *= 0.72 + vignette * 0.42;
  color += (hash21(frag + floor(time * 24.0)) - 0.5) / 255.0;

  outColor = vec4(color, 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to allocate WebGL shader.');

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unknown shader compilation error.';
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

export function AmberField({ stage, progress }: AmberFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef(stage);
  const progressRef = useRef(progress);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      setFallback(true);
      return;
    }

    let animationFrame = 0;
    let disposed = false;
    const pointer = { x: 0.62, y: 0.42 };
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    try {
      const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
      const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
      const program = gl.createProgram();
      if (!program) throw new Error('Unable to allocate WebGL program.');

      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || 'Unknown WebGL link error.');
      }

      const positionLocation = gl.getAttribLocation(program, 'a_position');
      const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
      const pointerLocation = gl.getUniformLocation(program, 'u_pointer');
      const timeLocation = gl.getUniformLocation(program, 'u_time');
      const stageLocation = gl.getUniformLocation(program, 'u_stage');
      const progressLocation = gl.getUniformLocation(program, 'u_progress');
      const motionLocation = gl.getUniformLocation(program, 'u_motion');

      const vao = gl.createVertexArray();
      const buffer = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
        const width = Math.max(1, Math.round(rect.width * dpr));
        const height = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
      };

      const observer = new ResizeObserver(resize);
      observer.observe(canvas);
      resize();

      const onPointerMove = (event: PointerEvent) => {
        if (reducedMotion.matches) return;
        const rect = canvas.getBoundingClientRect();
        pointer.x = (event.clientX - rect.left) / Math.max(rect.width, 1);
        pointer.y = 1 - (event.clientY - rect.top) / Math.max(rect.height, 1);
      };
      canvas.addEventListener('pointermove', onPointerMove, { passive: true });

      const start = performance.now();
      const render = (now: number) => {
        if (disposed) return;
        gl.useProgram(program);
        gl.bindVertexArray(vao);
        gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
        gl.uniform2f(pointerLocation, pointer.x, pointer.y);
        gl.uniform1f(timeLocation, (now - start) / 1000);
        gl.uniform1f(stageLocation, stageRef.current);
        gl.uniform1f(progressLocation, progressRef.current);
        gl.uniform1f(motionLocation, reducedMotion.matches ? 0 : 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        animationFrame = requestAnimationFrame(render);
      };
      animationFrame = requestAnimationFrame(render);

      return () => {
        disposed = true;
        cancelAnimationFrame(animationFrame);
        observer.disconnect();
        canvas.removeEventListener('pointermove', onPointerMove);
        gl.deleteBuffer(buffer);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
      };
    } catch (error) {
      console.error('Amber Field WebGL initialization failed:', error);
      setFallback(true);
      return undefined;
    }
  }, []);

  return (
    <div className={`amber-field ${fallback ? 'amber-field--fallback' : ''}`} aria-hidden="true">
      <canvas ref={canvasRef} className="amber-field__canvas" />
      <div className="amber-field__fallback" />
      <div className="amber-field__scan" />
    </div>
  );
}
