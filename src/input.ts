// Pointer input: window dragging, gated so it never swallows a touch.
//
// touch is the app's only verb and must always win: dragging begins only after
// the pointer moves past a small threshold, and never when the press began on
// something a hit-test claims (a butterfly, later). A press and release under
// the threshold falls through as a plain click.

const DRAG_THRESHOLD_PX = 4;

// asked where the press landed so it can decide whether that point is a
// butterfly (which owns the press) or bare paper (which may become a drag)
export type HitTestFn = (x: number, y: number) => boolean;

let dragHitTest: HitTestFn = () => false;

export function registerDragHitTest(fn: HitTestFn): void {
  dragHitTest = fn;
}

// only the drag-start capability is needed here — kept structural for decoupling
interface DraggableWindow {
  startDragging(): Promise<void>;
}

export function setupDragging(appWindow: DraggableWindow): void {
  let pointerDownPos: { x: number; y: number } | null = null;
  let pressClaimed = false;
  let isDragging = false;

  window.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    pointerDownPos = { x: e.clientX, y: e.clientY };
    pressClaimed = dragHitTest(e.clientX, e.clientY);
    isDragging = false;
  });

  window.addEventListener("mousemove", (e) => {
    if (!pointerDownPos || pressClaimed || isDragging) return;
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      isDragging = true;
      appWindow.startDragging();
    }
  });

  window.addEventListener("mouseup", () => {
    pointerDownPos = null;
    isDragging = false;
    pressClaimed = false;
  });
}
