import { BLUE_SPORTS_POSES } from "./blue-sportswear.js";
import { BLACK_SPORTS_POSES } from "./black-sportswear.js";
import { WHITE_SPORTS_POSES } from "./white-sportswear.js";
import { GREEN_SPORTS_POSES } from "./green-sportswear.js";
import { normalizeOutfit, WARDROBE } from "./wardrobe.js";
/** Static poses, white backgrounds and per-character content-centered viewports. */
const freezeRects = (rects) =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(rects).map(([variant, rect]) => [
        variant,
        Object.freeze(rect),
      ]),
    ),
  );
const freezePose = (pose) =>
  Object.freeze({
    ...pose,
    viewports: freezeRects(pose.viewports),
    bounds: freezeRects(pose.bounds),
    clips: freezeRects(pose.clips),
  });
export const MASCOT_POSES = Object.freeze(
  [
    {
      id: "basic",
      label: "기본",
      category: "basic",
      description: "편안하게 서 있는 기본 모습",
      file: "basic.png",
      sourceName: "basic.svg",
      width: 1600,
      height: 1000,
      background: "white",
      viewports: {
        cream: [-5.5814, -11.9767, 811.1628, 1013.9535],
        gray: [794.9186, -11.9767, 811.1628, 1013.9535],
      },
      sha256:
        "4658518c3d0f7912d51c583ff4613924d6de1a734b9810385aac8b6c1acf7672",
      sourceSha256:
        "9d5269afefeafd4c9ba322a10f3c713a2f2f439e1d9079b5ff5380a37afef7c8",
      backgroundEdited: false,
      bounds: {
        cream: [61, 59, 678, 872],
        gray: [882, 59, 637, 872],
      },
      clips: {
        cream: [0, 0, 800, 1000],
        gray: [800, 0, 800, 1000],
      },
    },
    {
      id: "curious",
      label: "궁금",
      category: "emotion",
      description: "무언가 궁금한 순간",
      file: "curious.png",
      sourceName: "궁금.png",
      width: 1254,
      height: 1254,
      background: "white",
      viewports: {
        cream: [50.3023, 261.6279, 581.3953, 726.7442],
        gray: [614.1628, 262.4535, 597.6744, 747.093],
      },
      sha256:
        "d9d744f51f0f72b7e41376fe3b503f7b523398ea7b7c11a4be16b3f70dbfbb66",
      sourceSha256:
        "d9d744f51f0f72b7e41376fe3b503f7b523398ea7b7c11a4be16b3f70dbfbb66",
      backgroundEdited: false,
      bounds: {
        cream: [91, 320, 500, 610],
        gray: [656, 342, 514, 588],
      },
      clips: {
        cream: [0, 0, 627, 1254],
        gray: [627, 0, 627, 1254],
      },
    },
    {
      id: "a-plus",
      label: "에이쁠",
      category: "emotion",
      description: "좋은 기록을 달성한 순간",
      file: "a-plus.png",
      sourceName: "에이쁠.png",
      width: 1254,
      height: 1254,
      background: "white",
      viewports: {
        cream: [3.9302, 225.1628, 658.1395, 822.6744],
        gray: [609.1395, 236.6744, 643.7209, 804.6512],
      },
      sha256:
        "f6731b0ca7c2948a5a3871b91f149300df05fc0821fe8417bc70400f1d50fe8e",
      sourceSha256:
        "f6731b0ca7c2948a5a3871b91f149300df05fc0821fe8417bc70400f1d50fe8e",
      backgroundEdited: false,
      bounds: {
        cream: [50, 294, 566, 685],
        gray: [657, 293, 548, 692],
      },
      clips: {
        cream: [0, 0, 627, 1254],
        gray: [627, 0, 627, 1254],
      },
    },
    {
      id: "drink",
      label: "드링크",
      category: "exercise",
      description: "운동 후 한 잔의 여유",
      file: "drink.png",
      sourceName: "드링크.png",
      width: 1254,
      height: 1254,
      background: "white",
      viewports: {
        cream: [19.2907, 239.4884, 634.4186, 793.0233],
        gray: [594.3953, 238.2442, 637.2093, 796.5116],
      },
      sha256:
        "06708970c0dad930644af17bf0b33e2613304c65c9478e3024a40aa2c4ce1187",
      sourceSha256:
        "06708970c0dad930644af17bf0b33e2613304c65c9478e3024a40aa2c4ce1187",
      backgroundEdited: false,
      bounds: {
        cream: [77, 295, 519, 682],
        gray: [660, 294, 506, 685],
      },
      clips: {
        cream: [0, 0, 627, 1254],
        gray: [627, 0, 627, 1254],
      },
    },
    {
      id: "lying",
      label: "눕",
      category: "rest",
      description: "편안하게 누워 쉬는 시간",
      file: "lying-white.png",
      sourceName: "눕.png",
      width: 1448,
      height: 1086,
      background: "white",
      viewports: {
        cream: [162.5, 196.75, 550, 687.5],
        gray: [711.7442, 207.4302, 546.5116, 683.1395],
      },
      sha256:
        "67938b6a253135f37fd860ef07511c7942e6f221334553176b9c5e3b30af70a8",
      sourceSha256:
        "ba470624fff1bcaf05075c756cffac23430e4504c862a79a1c31179e52ea94d5",
      backgroundEdited: true,
      bounds: {
        cream: [201, 286, 473, 509],
        gray: [750, 297, 470, 504],
      },
      clips: {
        cream: [0, 0, 724, 1086],
        gray: [724, 0, 724, 1086],
      },
    },
    {
      id: "stretch",
      label: "스트레칭",
      category: "exercise",
      description: "몸을 천천히 풀어 주는 준비",
      file: "stretch.png",
      sourceName: "스트레칭.png",
      width: 1254,
      height: 1254,
      background: "white",
      viewports: {
        cream: [24.1047, 228.0058, 612.7907, 765.9884],
        gray: [609.8605, 225.8256, 616.2791, 770.3488],
      },
      sha256:
        "fa7027f802ae1a63c32cbd7442d1140b01234b2874a5ce2f0882de3ed129c862",
      sourceSha256:
        "fa7027f802ae1a63c32cbd7442d1140b01234b2874a5ce2f0882de3ed129c862",
      backgroundEdited: false,
      bounds: {
        cream: [67, 301, 527, 620],
        gray: [653, 301, 530, 620],
      },
      clips: {
        cream: [0, 0, 627, 1254],
        gray: [627, 0, 627, 1254],
      },
    },
    {
      id: "run",
      label: "러닝",
      category: "exercise",
      description: "한 걸음씩 앞으로",
      file: "run-white.png",
      sourceName: "러닝.png",
      width: 1448,
      height: 1086,
      background: "white",
      viewports: {
        cream: [178.9651, 212.3314, 529.0698, 661.3372],
        gray: [701.1744, 217.093, 524.6512, 655.814],
      },
      sha256:
        "3bcfe377fdfad877d922325baecc059cbfb4b6114f263492fa7f648f2c6695e0",
      sourceSha256:
        "8cc84460b11e397472066081cd0774a0216a7536c0923ff16a5de851f994d4b9",
      backgroundEdited: true,
      bounds: {
        cream: [216, 260, 455, 566],
        gray: [742, 263, 443, 564],
      },
      clips: {
        cream: [0, 0, 724, 1086],
        gray: [724, 0, 724, 1086],
      },
    },
    {
      id: "passion",
      label: "열정",
      category: "emotion",
      description: "의욕이 가득한 시작",
      file: "passion.png",
      sourceName: "열정.png",
      width: 1254,
      height: 1254,
      background: "white",
      viewports: {
        cream: [-39.0349, 145.0814, 719.0698, 898.8372],
        gray: [569.4651, 145.0814, 719.0698, 898.8372],
      },
      sha256:
        "686cbd59c922b92051105bb5b407c8a422f4383b0d9d6a5e7a227b76153da19c",
      sourceSha256:
        "686cbd59c922b92051105bb5b407c8a422f4383b0d9d6a5e7a227b76153da19c",
      backgroundEdited: false,
      bounds: {
        cream: [33, 208, 575, 773],
        gray: [637, 208, 584, 773],
      },
      clips: {
        cream: [0, 0, 627, 1254],
        gray: [627, 0, 627, 1254],
      },
    },
    {
      id: "victory",
      label: "빅토리",
      category: "emotion",
      description: "해냈다는 기쁜 순간",
      file: "victory.png",
      sourceName: "빅토리.png",
      width: 1254,
      height: 1254,
      background: "white",
      viewports: {
        cream: [-9.2326, 229.7093, 660.4651, 825.5814],
        gray: [585.6279, 224.0349, 676.7442, 845.9302],
      },
      sha256:
        "d312afe8e4ad647e2f88643934fae2d7e371756b13e3a58d01937d7bfcd7095a",
      sourceSha256:
        "d312afe8e4ad647e2f88643934fae2d7e371756b13e3a58d01937d7bfcd7095a",
      backgroundEdited: false,
      bounds: {
        cream: [37, 292, 568, 701],
        gray: [633, 301, 582, 692],
      },
      clips: {
        cream: [0, 0, 627, 1254],
        gray: [627, 0, 627, 1254],
      },
    },
    {
      id: "pushup",
      label: "푸시업",
      category: "exercise",
      description: "꾸준히 쌓아 가는 힘",
      file: "pushup-white.png",
      sourceName: "푸시업.png",
      width: 1448,
      height: 1086,
      background: "white",
      viewports: {
        cream: [100.5, 191.25, 650, 812.5],
        gray: [699.314, 191.5174, 638.3721, 797.9651],
      },
      sha256:
        "aa081f9186abf641682ac6ca03c0787d4a996698b0e7e8ef29f87922b1617da9",
      sourceSha256:
        "3bab5bcdcbb7a5e36e2a047106ca23abc63e28b6c74a5e37cc9b640561a1bc4d",
      backgroundEdited: true,
      bounds: {
        cream: [146, 387, 559, 421],
        gray: [744, 374, 549, 433],
      },
      clips: {
        cream: [0, 0, 724, 1086],
        gray: [724, 0, 724, 1086],
      },
    },
    {
      id: "situp",
      label: "윗몸",
      category: "exercise",
      description: "오늘의 운동에 집중",
      file: "situp-white.png",
      sourceName: "윗몸.png",
      width: 1448,
      height: 1086,
      background: "white",
      viewports: {
        cream: [165.9302, 218.1628, 558.1395, 697.6744],
        gray: [721.7442, 226.9302, 546.5116, 683.1395],
      },
      sha256:
        "a127790e80fd38b47d9df13712f2bfee51baffff955f981db96f277a803f5316",
      sourceSha256:
        "4f41987134bf56734e31e585baa62e17a75d4162083e3ad57e28337e861c0293",
      backgroundEdited: true,
      bounds: {
        cream: [205, 289, 480, 556],
        gray: [760, 292, 470, 553],
      },
      clips: {
        cream: [0, 0, 724, 1086],
        gray: [724, 0, 724, 1086],
      },
    },
    {
      id: "droopy",
      label: "추욱",
      category: "rest",
      description: "조금 지친 날의 휴식",
      file: "droopy.png",
      sourceName: "추욱.png",
      width: 1254,
      height: 1254,
      background: "white",
      viewports: {
        cream: [50.8605, 317.3256, 556.2791, 695.3488],
        gray: [632.8488, 313.936, 559.3023, 699.1279],
      },
      sha256:
        "2e9252b84c7dacacfcc17503dcd009295fcfe57b6afcff0fcef93fc7aee33fe9",
      sourceSha256:
        "2e9252b84c7dacacfcc17503dcd009295fcfe57b6afcff0fcef93fc7aee33fe9",
      backgroundEdited: false,
      bounds: {
        cream: [94, 366, 470, 598],
        gray: [672, 363, 481, 601],
      },
      clips: {
        cream: [0, 0, 627, 1254],
        gray: [627, 0, 627, 1254],
      },
    },
    {
      id: "cant-hear",
      label: "안들려",
      category: "rest",
      description: "나만의 시간에 집중",
      file: "cant-hear.png",
      sourceName: "안들려.png",
      width: 1254,
      height: 1254,
      background: "white",
      viewports: {
        cream: [25.9419, 239.5523, 615.1163, 768.8953],
        gray: [601.8721, 230.4651, 623.2558, 779.0698],
      },
      sha256:
        "29ef1dbb4c18d83cd82c40354fe02d3dabb57744092747c2ef36b1048455c1d3",
      sourceSha256:
        "29ef1dbb4c18d83cd82c40354fe02d3dabb57744092747c2ef36b1048455c1d3",
      backgroundEdited: false,
      bounds: {
        cream: [69, 294, 529, 660],
        gray: [647, 285, 533, 670],
      },
      clips: {
        cream: [0, 0, 627, 1254],
        gray: [627, 0, 627, 1254],
      },
    },
    {
      id: "phone",
      label: "휴대폰",
      category: "daily",
      description: "휴대폰을 확인하는 순간",
      file: "phone.png",
      sourceName: "phone.png",
      width: 1254,
      height: 1254,
      background: "white",
      viewports: {
        cream: [31.186, 261.2326, 611.6279, 764.5349],
        gray: [603.7791, 256.5988, 617.4419, 771.8023],
      },
      bounds: {
        cream: [74, 316, 526, 655],
        gray: [647, 314, 531, 657],
      },
      clips: {
        cream: [0, 0, 627, 1254],
        gray: [627, 0, 627, 1254],
      },
      sha256:
        "5506335fd6190275fb2eee71e278258d94925e79fd74b3de2794f84740198ebe",
      sourceSha256:
        "5506335fd6190275fb2eee71e278258d94925e79fd74b3de2794f84740198ebe",
      backgroundEdited: false,
    },
  ].map(freezePose),
);
export const POSE_CATEGORIES = Object.freeze(
  [
    { id: "basic", label: "기본" },
    { id: "emotion", label: "감정" },
    { id: "exercise", label: "운동" },
    { id: "rest", label: "휴식" },
    { id: "daily", label: "일상" },
  ].map(Object.freeze),
);

const outfitImages = Object.freeze(
  Object.fromEntries(
    Object.entries({
      "blue-sportswear": BLUE_SPORTS_POSES,
      "black-sportswear": BLACK_SPORTS_POSES,
      "white-sportswear": WHITE_SPORTS_POSES,
      "green-sportswear": GREEN_SPORTS_POSES,
    }).map(([wear, poses]) => [
      wear,
      Object.freeze(
        Object.fromEntries(
          Object.entries(poses).map(([id, art]) => [
            id,
            freezePose({ ...art, sourceSha256: art.sha256 }),
          ]),
        ),
      ),
    ]),
  ),
);

/** Select an intact supplied image. The fourth argument is the current outfit. */
export function getMascotPose(
  poseId,
  variant = "cream",
  assetBasePath = "assets/poses",
  outfit = {},
) {
  const basePose = MASCOT_POSES.find((p) => p.id === poseId);
  if (!basePose) throw new RangeError(`Unknown mascot pose: ${poseId}`);
  if (!["cream", "gray"].includes(variant))
    throw new RangeError(`Unknown mascot variant: ${variant}`);
  const current = normalizeOutfit(outfit);
  if (current.wear && !outfitImages[current.wear][poseId])
    throw new RangeError(`Unsupported outfit for mascot pose: ${poseId}`);
  const art = current.wear
    ? { ...basePose, ...outfitImages[current.wear][poseId] }
    : basePose;
  const base = String(assetBasePath).replace(/\/+$/, "");
  return {
    ...art,
    variant,
    outfit: current,
    src: `${base ? base + "/" : String(assetBasePath).startsWith("/") ? "/" : ""}${art.file}`,
    viewBox: art.viewports[variant].join(" "),
    viewport: art.viewports[variant],
    clip: art.clips[variant],
    clipPolygon: art.clipPolygons?.[variant] ?? null,
    artBounds: art.bounds[variant],
  };
}
let poseSequence = 0;
/** Static photo controller. No overlay layers, image distortion or motion timer. */
export function createMascotPose(container, initial = {}) {
  if (!container?.appendChild)
    throw new TypeError("A DOM container is required");
  const doc = container.ownerDocument,
    NS = "http://www.w3.org/2000/svg",
    uid = `mascot-pose-${++poseSequence}`,
    el = (tag) => doc.createElementNS(NS, tag);
  const svg = el("svg"),
    defs = el("defs"),
    clip = el("clipPath"),
    rect = el("rect"),
    polygon = el("polygon"),
    image = el("image");
  svg.setAttribute("class", "mascot-pose");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("width", "800");
  svg.setAttribute("height", "1000");
  Object.assign(svg.style, {
    display: "block",
    maxWidth: "100%",
    height: "auto",
    aspectRatio: "4 / 5",
    overflow: "hidden",
    backgroundColor: "#fff",
  });
  clip.id = uid;
  clip.setAttribute("clipPathUnits", "userSpaceOnUse");
  clip.append(rect);
  defs.append(clip);
  svg.append(defs, image);
  image.dataset.poseSource = "";
  image.setAttribute("clip-path", `url(#${uid})`);
  let options = {
      pose: "curious",
      variant: "cream",
      assetBasePath: "assets/poses",
      size: 320,
      outfit: {},
    },
    destroyed = false;
  function update(next = {}) {
    if (destroyed) return;
    const merged = {
      ...options,
      ...Object.fromEntries(
        Object.entries(next).filter(([, v]) => v !== undefined),
      ),
    };
    const art = getMascotPose(
      merged.pose,
      merged.variant,
      merged.assetBasePath,
      merged.outfit,
    );
    if (!Number.isFinite(merged.size) || merged.size < 24)
      throw new RangeError("size must be a finite number of at least 24");
    options = { ...merged, outfit: art.outfit };
    image.setAttribute("width", String(art.width));
    image.setAttribute("height", String(art.height));
    if (image.getAttribute("href") !== art.src)
      image.setAttribute("href", art.src);
    const [x, y, width, height] = art.clip;
    for (const [k, v] of Object.entries({ x, y, width, height }))
      rect.setAttribute(k, String(v));
    if (art.clipPolygon) {
      polygon.setAttribute("points", art.clipPolygon);
      clip.replaceChildren(polygon);
    } else clip.replaceChildren(rect);
    svg.setAttribute("viewBox", art.viewBox);
    svg.style.width = `${Math.min(2000, options.size)}px`;
    const label =
      options.label ??
      `${options.variant === "cream" ? "크림" : "그레이"} 햄스터 · ${art.label}${options.outfit.wear ? " · " + WARDROBE.find((item) => item.id === options.outfit.wear).label : ""}`;
    if (label) {
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", label);
      svg.removeAttribute("aria-hidden");
    } else {
      svg.removeAttribute("role");
      svg.removeAttribute("aria-label");
      svg.setAttribute("aria-hidden", "true");
    }
    svg.dataset.pose = options.pose;
    svg.dataset.variant = options.variant;
    svg.dataset.static = "true";
    svg.dataset.outfit = JSON.stringify(options.outfit);
  }
  update(initial);
  container.appendChild(svg);
  return {
    element: svg,
    update,
    getState: () => ({
      ...options,
      outfit: { ...options.outfit },
      animated: false,
    }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      svg.remove();
    },
  };
}
