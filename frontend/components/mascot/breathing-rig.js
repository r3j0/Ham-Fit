/** The original breathing and walking motions. */
export const MOTION_PRESETS = [
  {
    id: "idle",
    label: "호흡",
    cycleSeconds: 5.6,
    min: 2,
    max: 20,
    description: "편안하게 들숨과 날숨",
  },
  {
    id: "walk",
    label: "걷기",
    cycleSeconds: 1.2,
    min: 0.65,
    max: 3,
    description: "두 발을 번갈아 내딛기",
  },
];
const clamp = (n, min, max, fallback) =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function envelope(phase, start, peak, end) {
  if (phase <= start || phase >= end) return 0;
  return phase < peak
    ? smoother((phase - start) / (peak - start))
    : 1 - smoother((phase - peak) / (end - peak));
}

export function getBreathPose(phase, intensity = 1) {
  const p = ((phase % 1) + 1) % 1;
  const amount = clamp(intensity, 0, 2, 1);
  return {
    chest: envelope(p, 0, 0.43, 0.94) * amount,
    head: envelope(p, 0.025, 0.475, 0.975) * amount,
    arms: envelope(p, 0.05, 0.49, 0.99) * amount,
    belly: envelope(p, 0, 0.405, 0.92) * amount,
  };
}

/** This rig uses absolute M/C paths. Every point at/below y=840 stays fixed. */
export function compileTorsoMorph(path) {
  const tokens = path.match(/[MCZ]|-?\d*\.?\d+/g) ?? [];
  let axis = 0;
  const points = tokens.map((token) => {
    if (/^[MCZ]$/.test(token)) return token;
    return { value: Number(token), axis: axis++ % 2 };
  });
  return (breath) =>
    points
      .map((point, i) => {
        if (typeof point === "string") return point;
        const y = point.axis === 1 ? point.value : points[i + 1].value;
        const weight = smoother(clamp((840 - y) / 300, 0, 1, 0));
        const value =
          point.axis === 1
            ? point.value - 20 * breath * weight
            : point.value + Math.sign(point.value - 400) * 12 * breath * weight;
        return value.toFixed(3);
      })
      .join(" ");
}

/** One full cycle is two steps. A planted foot does not move. */
export function getWalkPose(phase, intensity = 1) {
  const p = ((phase % 1) + 1) % 1;
  const amount = clamp(intensity, 0, 2, 1);
  const wave = Math.sin(p * Math.PI * 2);
  const foot = (offset, side) => {
    const cycle = (p + offset) % 1;
    if (cycle <= 0.54) return { x: 0, y: 0, angle: 0, planted: true };
    const swing = (cycle - 0.54) / 0.46;
    const lift = Math.sin(Math.PI * swing) ** 2;
    return {
      x: side * 4 * lift * amount,
      y: -16 * lift * amount,
      angle: side * 3 * lift * (1 - 2 * swing) * amount,
      planted: false,
    };
  };
  return {
    x: 3.5 * wave * amount,
    y: -3 * wave * wave * amount,
    angle: 0.45 * wave * amount,
    arm: 7 * wave * amount,
    nod: -0.35 * wave * amount,
    headY: -0.8 * Math.sin(p * Math.PI * 4) * amount,
    leftFoot: foot(0, -1),
    rightFoot: foot(0.5, 1),
  };
}

const turnPoint = (x, y, angle, cx, cy) => {
  const r = (angle * Math.PI) / 180;
  return [
    cx + (x - cx) * Math.cos(r) - (y - cy) * Math.sin(r),
    cy + (x - cx) * Math.sin(r) + (y - cy) * Math.cos(r),
  ];
};

/** Skin the continuous body outline to the torso and the two independent feet.
 * This avoids seams where short legs meet the belly. Feet below y=900 follow
 * their own transform completely. The walking support foot stays fixed.
 */
export function compileWalkMorph(path) {
  const commands = path.match(/[MCZ]|-?\d*\.?\d+/g) ?? [];
  const tokens = [];
  for (let i = 0; i < commands.length; i++) {
    const token = commands[i];
    if (/^[MCZ]$/.test(token)) tokens.push(token);
    else tokens.push([Number(token), Number(commands[++i])]);
  }
  return (pose) =>
    tokens
      .map((token) => {
        if (typeof token === "string") return token;
        const [x, y] = token;
        const legWeight = smoother(clamp((y - 770) / 130, 0, 1, 0));
        const rightWeight = smoother(clamp((x - 365) / 70, 0, 1, 0));
        const torso = turnPoint(x, y, pose.angle, 400, 840);
        torso[0] += pose.x;
        torso[1] += pose.y;
        const left = turnPoint(x, y, pose.leftFoot.angle, 300, 875);
        const right = turnPoint(x, y, pose.rightFoot.angle, 505, 875);
        left[0] =
          300 + (left[0] - 300) * (pose.leftFoot.scaleX ?? 1) + pose.leftFoot.x;
        left[1] =
          875 + (left[1] - 875) * (pose.leftFoot.scaleY ?? 1) + pose.leftFoot.y;
        right[0] =
          505 +
          (right[0] - 505) * (pose.rightFoot.scaleX ?? 1) +
          pose.rightFoot.x;
        right[1] =
          875 +
          (right[1] - 875) * (pose.rightFoot.scaleY ?? 1) +
          pose.rightFoot.y;
        return [0, 1]
          .map((axis) =>
            (
              torso[axis] * (1 - legWeight) +
              (left[axis] * (1 - rightWeight) + right[axis] * rightWeight) *
                legWeight
            ).toFixed(3),
          )
          .join(" ");
      })
      .join(" ");
}

export function createBreathingRig(svg, initial = {}) {
  const nodes = Object.fromEntries(
    ["torso-fill", "torso", "head", "left-arm", "right-arm", "belly"].map(
      (part) => {
        const node = svg.querySelector(`[data-part="${part}"]`);
        if (!node) throw new Error(`Breathing rig is missing ${part}`);
        return [part, node];
      },
    ),
  );
  const morphs = ["torso-fill", "torso"].map((part) => {
    const path = nodes[part].getAttribute("d");
    return {
      node: nodes[part],
      rest: path,
      morph: compileTorsoMorph(path),
      walk: compileWalkMorph(path),
    };
  });
  const paintedPaths = new Map();
  const paintPath = (node, path) => {
    node.setAttribute("d", path);
    paintedPaths.set(node, path);
  };
  const pivots = ["left-arm", "right-arm"].map((part) =>
    nodes[part].getAttribute("data-pivot").split(",").map(Number),
  );
  const syncWearClip = () =>
    svg
      .querySelectorAll("[data-wear-clip]")
      .forEach((node) =>
        node.setAttribute("d", nodes["torso-fill"].getAttribute("d")),
      );
  const originalTransforms = Object.fromEntries(
    Object.entries(nodes).map(([key, node]) => [
      key,
      node.getAttribute("transform"),
    ]),
  );
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let options = {
    motion: "idle",
    cycleSeconds: 5.6,
    intensity: 1,
    paused: false,
  };
  let phase = 0;
  let last = performance.now();
  let frame = 0;
  let destroyed = false;
  const f = (n) => n.toFixed(4);
  const running = () =>
    !options.paused &&
    options.intensity > 0 &&
    !media.matches &&
    !document.hidden;
  function paint() {
    const amount = media.matches ? 0 : options.intensity;
    svg.dataset.motion = options.motion;
    if (options.motion === "walk") {
      const pose = getWalkPose(phase, amount);
      const spine = `translate(${f(pose.x)} ${f(pose.y)}) rotate(${f(pose.angle)} 400 840)`;
      morphs.forEach(({ node, walk }) => paintPath(node, walk(pose)));
      nodes.head.setAttribute(
        "transform",
        `${spine} translate(0 ${f(pose.headY)}) rotate(${f(pose.nod)} 400 610)`,
      );
      nodes["left-arm"].setAttribute(
        "transform",
        `${spine} rotate(${f(pose.arm)} ${pivots[0].join(" ")})`,
      );
      nodes["right-arm"].setAttribute(
        "transform",
        `${spine} rotate(${f(pose.arm)} ${pivots[1].join(" ")})`,
      );
      nodes.belly.setAttribute("transform", spine);
      svg
        .querySelectorAll('[data-follow="body"]')
        .forEach((node) => node.setAttribute("transform", spine));
      syncWearClip();
      return;
    }
    const pose = getBreathPose(phase, media.matches ? 0 : options.intensity);
    morphs.forEach(({ node, morph }) => paintPath(node, morph(pose.chest)));
    // Head and hands remain rigid: translation + rotation, never scale.
    nodes.head.setAttribute(
      "transform",
      `translate(${f(-1.6 * pose.head)} ${f(-13 * pose.head)}) rotate(${f(-0.75 * pose.head)} 400 610)`,
    );
    nodes["left-arm"].setAttribute(
      "transform",
      `translate(${f(-3.5 * pose.chest)} ${f(-7 * pose.chest)}) rotate(${f(6 * pose.arms)} ${pivots[0].join(" ")})`,
    );
    nodes["right-arm"].setAttribute(
      "transform",
      `translate(${f(3.5 * pose.chest)} ${f(-7 * pose.chest)}) rotate(${f(-5.5 * pose.arms)} ${pivots[1].join(" ")})`,
    );
    nodes.belly.setAttribute("transform", `translate(0 ${f(-9 * pose.belly)})`);
    svg
      .querySelectorAll('[data-follow="body"]')
      .forEach((node) =>
        node.setAttribute("transform", `translate(0 ${f(-9 * pose.belly)})`),
      );
    syncWearClip();
  }
  function tick(now) {
    frame = 0;
    if (destroyed || !running()) return;
    phase = (phase + (now - last) / (options.cycleSeconds * 1000)) % 1;
    last = now;
    paint();
    frame = requestAnimationFrame(tick);
  }
  function schedule() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = performance.now();
    paint();
    if (running()) frame = requestAnimationFrame(tick);
  }
  const update = (next) => {
    if (destroyed) return;
    const motion =
      next.motion === undefined
        ? options.motion
        : MOTION_PRESETS.some((item) => item.id === next.motion)
          ? next.motion
          : "idle";
    const changed = motion !== options.motion;
    if (changed) phase = 0;
    const preset = MOTION_PRESETS.find((item) => item.id === motion);
    const defaultCycle = preset.cycleSeconds;
    const minCycle = preset.min;
    const maxCycle = preset.max;
    options = {
      motion,
      cycleSeconds: clamp(
        next.cycleSeconds ?? (changed ? defaultCycle : options.cycleSeconds),
        minCycle,
        maxCycle,
        defaultCycle,
      ),
      intensity: clamp(next.intensity ?? options.intensity, 0, 2, 1),
      paused: next.paused ?? options.paused,
    };
    schedule();
  };
  const visibility = () => schedule();
  media.addEventListener("change", visibility);
  document.addEventListener("visibilitychange", visibility);
  svg.addEventListener("mascot:outfit-change", visibility);
  update(initial);
  return {
    update,
    getState: () => ({
      phase,
      running: running(),
      reducedMotion: media.matches,
      ...options,
    }),
    /** Useful for a motion-review scrubber; pause first to hold the pose. */
    seek: (next) => {
      phase = clamp(next, 0, 1, 0) % 1;
      schedule();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(frame);
      media.removeEventListener("change", visibility);
      document.removeEventListener("visibilitychange", visibility);
      svg.removeEventListener("mascot:outfit-change", visibility);
      // Re-initialization (including React Strict Mode) starts from the source.
      // Do not overwrite geometry that React has already replaced for a variant.
      morphs.forEach(({ node, rest }) => {
        if (node.getAttribute("d") === paintedPaths.get(node))
          node.setAttribute("d", rest);
      });
      Object.entries(nodes).forEach(([key, node]) =>
        originalTransforms[key] === null
          ? node.removeAttribute("transform")
          : node.setAttribute("transform", originalTransforms[key]),
      );
      svg
        .querySelectorAll('[data-follow="body"]')
        .forEach((node) => node.removeAttribute("transform"));
      syncWearClip();
      delete svg.dataset.motion;
    },
  };
}

/** Preferred name for projects using multiple motions. */
export function createMascotRig(svg, options = {}) {
  return createBreathingRig(svg, options);
}
