import { OwnedTool } from '../generated/prisma/enums.js';

// Public API/DB order. Python names match recommendation_v2.py's equipment
// filter (including its dumbbell/step-box aliases); no filtering rules live here.
export const OWNED_TOOLS = Object.values(OwnedTool);
export const PYTHON_TOOL_NAMES: Record<OwnedTool, string> = {
  band: '밴드',
  dumbbell: '덤벨',
  gym_ball: '짐볼',
  foam_roller: '폼롤러',
  jump_rope: '줄넘기',
  step_box: '스텝박스',
  ball: '공',
  cone: '콘',
  agility_ladder: '사다리',
  bosu: '보슈',
};

export function normalizeOwnedTools(tools: readonly OwnedTool[]): OwnedTool[] {
  return OWNED_TOOLS.filter((tool) => tools.includes(tool));
}
