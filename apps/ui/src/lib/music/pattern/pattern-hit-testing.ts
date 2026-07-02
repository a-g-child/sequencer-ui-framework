import type { RenderItem } from './pattern-render-items';

export function hitTestRenderItem<TSource>(
  items: RenderItem<TSource>[],
  x: number,
  y: number
): RenderItem<TSource> | undefined {
  return [...items].reverse().find((item) => {
    const left = item.x;
    const right = item.x + item.width;
    const top = item.y;
    const bottom = item.y + item.height;

    return x >= left && x <= right && y >= top && y <= bottom;
  });
}
