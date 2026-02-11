import * as constants from "#asciiflow/client/constants";
import { store } from "#asciiflow/client/store";
import { Vector } from "#asciiflow/client/vector";
import { autorun, useWatchable } from "#asciiflow/common/watchable";
import * as React from "react";
import { useEffect } from "react";

/**
 * Handles view operations, state and management of the screen.
 */

function getColors() {
  if (store.darkMode.get()) {
    return {
      background: "#333",
      grid: "#444",
      text: "#DDD",
      highlight: "#444",
      selection: "#456",
    };
  }
  return {
    background: "#FFF",
    grid: "#EEE",
    text: "#333",
    highlight: "#F6F6F6",
    selection: "#DEF",
  };
}

export function setCanvasCursor(cursor: string) {
  const element = document.getElementById("ascii-canvas");
  if (element) {
    element.style.cursor = cursor;
  }
}

export const View = ({ ...rest }: React.HTMLAttributes<HTMLCanvasElement>) =>
  useWatchable(() => {
    const colors = getColors();
    useEffect(() => {
      const canvas = document.getElementById(
        "ascii-canvas"
      ) as HTMLCanvasElement;
      const disposer = autorun(() => render(canvas));
      return () => disposer();
    });

    // Attach a non-passive wheel listener so preventDefault() works for
    // both zoom (Ctrl+scroll) and pan (plain scroll). Without this,
    // macOS two-finger swipe left triggers browser back navigation.
    useEffect(() => {
      const canvas = document.getElementById("ascii-canvas") as HTMLCanvasElement;
      if (!canvas) return;
      const handler = (e: WheelEvent) => {
        e.preventDefault();
      };
      canvas.addEventListener("wheel", handler, { passive: false });
      return () => canvas.removeEventListener("wheel", handler);
    });

    // Add an cleanup an event listener on the window.
    useEffect(() => {
      const handler = () => {
        const canvas = document.getElementById(
          "ascii-canvas"
        ) as HTMLCanvasElement;
        const dpr = window.devicePixelRatio || 1;
        const cssW = document.documentElement.clientWidth;
        const cssH = document.documentElement.clientHeight;
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
        canvas.style.width = cssW + "px";
        canvas.style.height = cssH + "px";
        render(canvas);
      };
      window.addEventListener("resize", handler);
      return () => {
        window.removeEventListener("resize", handler);
      };
    });

    const dpr = window.devicePixelRatio || 1;
    const cssW = document.documentElement.clientWidth;
    const cssH = document.documentElement.clientHeight;
    return (
      <canvas
        width={cssW * dpr}
        height={cssH * dpr}
        tabIndex={0}
        style={{
          backgroundColor: colors.background,
          touchAction: "none",
          position: "fixed",
          left: 0,
          top: 0,
          width: cssW + "px",
          height: cssH + "px",
        }}
        id="ascii-canvas"
        {...rest}
      />
    );
  });

/**
 * Renders the given state to the canvas.
 * TODO: Room for efficiency here still. Drawing should be incremental,
 *       however performance is currently very acceptable on test devices.
 */
function render(canvas: HTMLCanvasElement) {
  const committed = store.currentCanvas.committed;
  const scratch = store.currentCanvas.scratch.get();
  const selection = store.currentCanvas.selection.get();

  const context = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  // CSS dimensions (what screenToFrame/screenToCell expect)
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;

  context.setTransform(1, 0, 0, 1, 0, 0);
  // Clear the full physical canvas.
  context.clearRect(0, 0, canvas.width, canvas.height);

  const zoom = store.currentCanvas.zoom;
  const offset = store.currentCanvas.offset;

  // Scale by DPR first so all subsequent coordinates are in CSS pixels,
  // then apply the zoom/translate as before.
  context.scale(dpr * zoom, dpr * zoom);
  context.translate(cssW / 2 / zoom, cssH / 2 / zoom);

  // Precompute device-pixel transform for pixel-perfect box drawing.
  // The combined transform maps CSS coord x → x * s + txDev in device pixels.
  const s = dpr * zoom;
  const txDev = canvas.width / 2;
  const tyDev = canvas.height / 2;

  // Compute visible cell range directly from viewport bounds.
  // We bypass screenToCell/frameToCell because frameToCell clamps to
  // Math.max(1,...) which prevents negative cell indices needed for
  // grid lines that extend to the left/top of the viewport.
  const pad = constants.RENDER_PADDING_CELLS;
  const startOffset = new Vector(
    Math.floor((-cssW / 2 / zoom + offset.x) / constants.CHAR_PIXELS_H) - pad,
    Math.floor((-cssH / 2 / zoom + offset.y) / constants.CHAR_PIXELS_V) - pad
  );
  const endOffset = new Vector(
    Math.ceil((cssW / 2 / zoom + offset.x) / constants.CHAR_PIXELS_H) + pad,
    Math.ceil((cssH / 2 / zoom + offset.y) / constants.CHAR_PIXELS_V) + pad
  );

  const colors = getColors();

  // Render the grid.
  context.lineWidth = 1;
  context.strokeStyle = colors.grid;
  context.beginPath();
  for (let i = startOffset.x; i < endOffset.x; i++) {
    context.moveTo(
      i * constants.CHAR_PIXELS_H - offset.x,
      startOffset.y * constants.CHAR_PIXELS_V - offset.y
    );
    context.lineTo(
      i * constants.CHAR_PIXELS_H - offset.x,
      endOffset.y * constants.CHAR_PIXELS_V - offset.y
    );
  }
  for (let j = startOffset.y; j < endOffset.y; j++) {
    context.moveTo(
      startOffset.x * constants.CHAR_PIXELS_H - offset.x,
      j * constants.CHAR_PIXELS_V - offset.y
    );
    context.lineTo(
      endOffset.x * constants.CHAR_PIXELS_H - offset.x,
      j * constants.CHAR_PIXELS_V - offset.y
    );
  }
  context.stroke();
  context.font = "15px Courier New";

  function highlight(position: Vector, color: string) {
    context.fillStyle = color;
    context.fillRect(
      position.x * constants.CHAR_PIXELS_H - offset.x + 0.5,
      (position.y - 1) * constants.CHAR_PIXELS_V - offset.y + 0.5,
      constants.CHAR_PIXELS_H - 1,
      constants.CHAR_PIXELS_V - 1
    );
  }

  // Box-drawing chars: render as filled rectangles for pixel-perfect connections.
  // Using fillRect instead of stroke avoids sub-pixel/DPR alignment issues.
  const BOX_DIRS: Record<string, number> = {
    '─':0b0011, '│':0b1100, '┌':0b0101, '┐':0b0110,
    '└':0b1001, '┘':0b1010, '├':0b1101, '┤':0b1110,
    '┬':0b0111, '┴':0b1011, '┼':0b1111,
  };
  const LINE_W = 1.5; // line thickness

  function text(position: Vector, value: string) {
    if (value === null || value === "" || value === " ") return;

    const dirs = BOX_DIRS[value];
    if (dirs !== undefined) {
      const W = constants.CHAR_PIXELS_H;
      const H = constants.CHAR_PIXELS_V;
      const ox = offset.x;
      const oy = offset.y;
      // Cell edges in CSS (pre-transform) coordinate space
      const left_css   = position.x * W - ox;
      const right_css  = (position.x + 1) * W - ox;
      const top_css    = (position.y - 1) * H - oy;
      const bottom_css = position.y * H - oy;
      const cx_css = (left_css + right_css) / 2;
      const cy_css = (top_css + bottom_css) / 2;

      // Snap to exact device pixels — eliminates anti-aliased edges on any DPR/zoom
      const dl  = Math.round(left_css * s + txDev);
      const dr  = Math.round(right_css * s + txDev);
      const dt  = Math.round(top_css * s + tyDev);
      const db  = Math.round(bottom_css * s + tyDev);
      const dcx = Math.round(cx_css * s + txDev);
      const dcy = Math.round(cy_css * s + tyDev);
      // Line width in device pixels (at least 1, snapped to integer)
      const devLW = Math.max(1, Math.round(LINE_W * s));
      const dhw = Math.floor(devLW / 2);

      // Draw directly in device pixel space, bypassing the canvas transform
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = colors.text;
      if (dirs & 0b0010) context.fillRect(dl, dcy - dhw, dcx - dl, devLW);     // left
      if (dirs & 0b0001) context.fillRect(dcx, dcy - dhw, dr - dcx, devLW);    // right
      if (dirs & 0b1000) context.fillRect(dcx - dhw, dt, devLW, dcy - dt);     // up
      if (dirs & 0b0100) context.fillRect(dcx - dhw, dcy, devLW, db - dcy);    // down
      // Restore the zoom/translate transform for subsequent drawing
      context.setTransform(s, 0, 0, s, txDev, tyDev);
      return;
    }

    context.fillStyle = colors.text;
    context.fillText(
      value,
      position.x * constants.CHAR_PIXELS_H - offset.x,
      position.y * constants.CHAR_PIXELS_V - offset.y - 3
    );
  }

  if (!!selection) {
    // Fill the selection box.
    const topLeft = selection.topLeft();
    const bottomRight = selection.bottomRight();
    for (let x = topLeft.x; x <= bottomRight.x; x++) {
      for (let y = topLeft.y; y <= bottomRight.y; y++) {
        highlight(new Vector(x, y), colors.selection);
      }
    }
  }
  for (const [position, value] of committed.entries()) {
    const cellValue = committed.get(position);
    text(position, cellValue);
  }
  for (const [position] of scratch.entries()) {
    highlight(position, colors.highlight);
    const cellValue = scratch.get(position);
    text(position, cellValue);
  }

  if (!!selection) {
    // Outline the selection box.
    const topLeft = selection.topLeft();
    const bottomRight = selection.bottomRight();
    context.lineWidth = 1;
    context.strokeStyle = colors.selection;
    context.beginPath();
    context.moveTo(
      topLeft.x * constants.CHAR_PIXELS_H - offset.x,
      (topLeft.y - 1) * constants.CHAR_PIXELS_V - offset.y
    );
    context.lineTo(
      topLeft.x * constants.CHAR_PIXELS_H - offset.x,
      bottomRight.y * constants.CHAR_PIXELS_V - offset.y
    );
    context.lineTo(
      (bottomRight.x + 1) * constants.CHAR_PIXELS_H - offset.x,
      bottomRight.y * constants.CHAR_PIXELS_V - offset.y
    );
    context.lineTo(
      (bottomRight.x + 1) * constants.CHAR_PIXELS_H - offset.x,
      (topLeft.y - 1) * constants.CHAR_PIXELS_V - offset.y
    );
    context.lineTo(
      topLeft.x * constants.CHAR_PIXELS_H - offset.x,
      (topLeft.y - 1) * constants.CHAR_PIXELS_V - offset.y
    );
    context.stroke();
  }
}

/**
 * Given a screen coordinate, find the frame coordinates.
 */
export function screenToFrame(vector: Vector) {
  const zoom = store.currentCanvas.zoom;
  const offset = store.currentCanvas.offset;
  return new Vector(
    (vector.x - document.documentElement.clientWidth / 2) / zoom + offset.x,
    (vector.y - document.documentElement.clientHeight / 2) / zoom + offset.y
  );
}

/**
 * Given a frame coordinate, find the screen coordinates.
 */
export function frameToScreen(vector: Vector) {
  const zoom = store.currentCanvas.zoom;
  const offset = store.currentCanvas.offset;
  return new Vector(
    (vector.x - offset.x) * zoom + document.documentElement.clientWidth / 2,
    (vector.y - offset.y) * zoom + document.documentElement.clientHeight / 2
  );
}

/**
 * Given a frame coordinate, return the indices for the nearest cell.
 */
export function frameToCell(vector: Vector) {
  // We limit the edges in a bit, as most drawing needs a full context to work.
  return new Vector(
    Math.min(
      Math.max(
        1,
        Math.round(
          (vector.x - constants.CHAR_PIXELS_H / 2) / constants.CHAR_PIXELS_H
        )
      ),
      constants.MAX_GRID_WIDTH - 2
    ),
    Math.min(
      Math.max(
        1,
        Math.round(
          (vector.y + constants.CHAR_PIXELS_V / 2) / constants.CHAR_PIXELS_V
        )
      ),
      constants.MAX_GRID_HEIGHT - 2
    )
  );
}

/**
 * Given a cell coordinate, return the frame coordinates.
 */
export function cellToFrame(vector: Vector) {
  return new Vector(
    Math.round(vector.x * constants.CHAR_PIXELS_H),
    Math.round(vector.y * constants.CHAR_PIXELS_V)
  );
}

/**
 * Given a screen coordinate, return the indices for the nearest cell.
 */
export function screenToCell(vector: Vector) {
  return frameToCell(screenToFrame(vector));
}

/**
 * Given a cell coordinate, return the on screen coordinates.
 */
export function cellToScreen(vector: Vector) {
  return frameToScreen(cellToFrame(vector));
}
