export interface MascotStateContext {
  state?: 'green' | 'yellow' | 'red' | string;
  rule?: string;
  isNotice?: boolean;
  notice?: string;
  isStale?: boolean;
  isExpensiveRequest?: boolean;
  isWalking?: boolean;
  healthyTicks?: number;
  animationOverride?: string;
  meter?: {
    usedPercent?: number;
    timeToResetFormatted?: string;
    isStale?: boolean;
    requestCostDisplay?: string;
    planType?: string;
    [key: string]: any;
  };
  skin?: {
    animations?: Record<string, any>;
    [key: string]: any;
  };
}

export type SupportedAnimation = 'idle' | 'walk' | 'sleep' | 'alert' | 'happy' | 'curious';

/**
 * Resolves the appropriate mascot animation name based on the current guardian condition,
 * falling back gracefully to available animations on the active skin.
 */
export function resolveMascotAnimation(
  context: MascotStateContext,
  availableAnimations?: string[] | Set<string> | Record<string, any>
): string {
  const anims = availableAnimations ?? context.skin?.animations;

  const hasAnim = (name: string): boolean => {
    if (!anims) return true;
    if (Array.isArray(anims)) return anims.includes(name);
    if (anims instanceof Set) return anims.has(name);
    if (typeof anims === 'object') return Boolean(anims[name]);
    return true;
  };

  const fallback = (preferred: string, fallbackName = 'idle'): string => {
    return hasAnim(preferred) ? preferred : fallbackName;
  };

  // Direct animation override (with fallback to idle if skin lacks it)
  if (context.animationOverride) {
    return fallback(context.animationOverride, 'idle');
  }

  // 1. Roaming active
  if (context.isWalking) {
    return fallback('walk');
  }

  // 2. Stale meter reading (takes precedence over alert state if rule is stale)
  if (context.isStale || context.rule === 'stale_reading' || context.meter?.isStale) {
    return fallback('sleep');
  }

  // 3. Warning or Alert (projected_exhaustion, single_request_high, yellow/red state)
  if (
    context.state === 'red' ||
    (context.state === 'yellow' && context.rule !== 'stale_reading') ||
    context.rule === 'projected_exhaustion' ||
    context.rule === 'single_request_high'
  ) {
    return fallback('alert');
  }

  // 4. Info Notice (e.g. model switch)
  if (context.isNotice || context.notice) {
    return fallback('happy');
  }

  // 5. New expensive request (notable request cost)
  if (context.isExpensiveRequest || context.meter?.requestCostDisplay) {
    return fallback('curious', 'idle');
  }

  // 6. Healthy / Normal
  return fallback('idle');
}
