import { Color } from "./color";
import { Transform } from "./geometry/transform";
import { Vector2, Vector3 } from "./geometry/vector";
import type { Vertex } from "./geometry/vertex";
import { Line } from "./shape/line";
import { Polygon } from "./shape/polygon";
import { Rectangle } from "./shape/rectangle";
import type { Shape } from "./shape/shape";
import { Square } from "./shape/square";
import {
  B,
  CLEAR_COLOR,
  COLOR_SIZE,
  FLOAT_SIZE,
  G,
  Nullable,
  ORANGE,
  PARENT_POSITION_INDEX,
  PARENT_ROTATION_INDEX,
  PARENT_SCALE_INDEX,
  POINT_RADIUS,
  POSITION_SIZE,
  R,
  VERTEX_SIZE,
} from "./util";

type ViewMode = "solid" | "wireframe";
type Mode = "object" | "edit";

class Viewer {
  private context: WebGLRenderingContext;
  private shapes: Shape[];
  private viewMode: ViewMode = "solid";
  private mode: Mode = "object";
  private selected: Nullable<Shape> = null;
  private selectedVertex: Nullable<Vertex> = null;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    // TODO: Try other contex, add guard
    this.context = canvas.getContext("webgl")!;
    this.canvas = canvas;
    this.shapes = [];
    this.context.viewport(0, 0, canvas.width, canvas.height);

    this.setupEventListeners();
    this.setup().then(this.start.bind(this));
  }

  async setup() {
    this.context.clearColor(CLEAR_COLOR.x, CLEAR_COLOR.y, CLEAR_COLOR.z, 1.0);

    const vertexShader = this.context.createShader(this.context.VERTEX_SHADER)!;
    let res = await fetch("vbasic.glsl");
    const vertexShaderSource = await res.text();
    this.context.shaderSource(vertexShader, vertexShaderSource);
    this.context.compileShader(vertexShader);
    const fragmentShader = this.context.createShader(
      this.context.FRAGMENT_SHADER
    )!;
    res = await fetch("fbasic.glsl");
    const fragmentShaderSource = await res.text();
    this.context.shaderSource(fragmentShader, fragmentShaderSource);
    this.context.compileShader(fragmentShader);
    const program = this.context.createProgram()!;
    this.context.attachShader(program, vertexShader);
    this.context.attachShader(program, fragmentShader);
    this.context.linkProgram(program);

    const buffer = this.context.createBuffer();
    this.context.bindBuffer(this.context.ARRAY_BUFFER, buffer);
    const vPositionAttribute = this.context.getAttribLocation(
      program,
      "vPosition"
    );
    const vColorAttribute = this.context.getAttribLocation(program, "vColor");
    const vParentPositionAttribute = this.context.getAttribLocation(
      program,
      "vParentPosition"
    );
    const vParentRotationAttribute = this.context.getAttribLocation(
      program,
      "vParentRotation"
    );
    const vParentScaleAttribute = this.context.getAttribLocation(
      program,
      "vParentScale"
    );
    this.context.vertexAttribPointer(
      vPositionAttribute,
      POSITION_SIZE,
      this.context.FLOAT,
      false,
      VERTEX_SIZE * FLOAT_SIZE,
      0
    );
    this.context.vertexAttribPointer(
      vColorAttribute,
      COLOR_SIZE,
      this.context.FLOAT,
      false,
      VERTEX_SIZE * FLOAT_SIZE,
      POSITION_SIZE * FLOAT_SIZE
    );
    this.context.vertexAttribPointer(
      vParentPositionAttribute,
      POSITION_SIZE,
      this.context.FLOAT,
      false,
      VERTEX_SIZE * FLOAT_SIZE,
      (POSITION_SIZE + COLOR_SIZE) * FLOAT_SIZE
    );
    this.context.vertexAttribPointer(
      vParentRotationAttribute,
      1,
      this.context.FLOAT,
      false,
      VERTEX_SIZE * FLOAT_SIZE,
      (POSITION_SIZE + COLOR_SIZE + POSITION_SIZE) * FLOAT_SIZE
    );
    this.context.vertexAttribPointer(
      vParentScaleAttribute,
      1,
      this.context.FLOAT,
      false,
      VERTEX_SIZE * FLOAT_SIZE,
      (POSITION_SIZE + COLOR_SIZE + POSITION_SIZE + 1) * FLOAT_SIZE
    );
    this.context.enableVertexAttribArray(vPositionAttribute);
    this.context.enableVertexAttribArray(vColorAttribute);
    this.context.enableVertexAttribArray(vParentPositionAttribute);
    this.context.enableVertexAttribArray(vParentRotationAttribute);
    this.context.enableVertexAttribArray(vParentScaleAttribute);

    console.log(this.context.getShaderInfoLog(vertexShader));
    console.log(this.context.getShaderInfoLog(fragmentShader));

    this.context.useProgram(program);
    // console.log(this.context.getProgramInfoLog(program));
  }

  setupEventListeners() {
    // TODO: implement
    window.addEventListener("keypress", (e: KeyboardEvent) => {
      console.log(e);
      this.onKeyPressed(e.code);
    });

    window.addEventListener("keydown", (e: KeyboardEvent) => {
      this.onKeyDown(e);
    });

    this.canvas.addEventListener("click", (e: PointerEvent) => {
      this.onClick(e);
    });
  }

  onKeyPressed(code: string) {
    switch (code) {
      case "KeyQ":
        this.setViewMode("solid");
        break;
      case "KeyW":
        this.setViewMode("wireframe");
        break;
      case "KeyX":
        if (this.selected) {
          const index = this.shapes.indexOf(this.selected);
          this.shapes.splice(index, 1);
        }
        break;
      case "KeyG":
        if (this.mode === "edit" && this.selectedVertex)
          this.grabSelectedVertex();
        if (this.mode === "object" && this.selected) this.grabSelected();
        break;
      case "KeyR":
        if (this.selected) this.rotateSelected();
        break;
      case "KeyS":
        if (this.selected) this.scaleSelected();
        break;
    }
  }

  onKeyDown(event: KeyboardEvent) {
    switch (event.code) {
      case "Tab":
        event.preventDefault();
        if (this.selected) this.switchMode();
        break;
    }
  }

  onClick(event: MouseEvent) {
    this.mode === "object"
      ? this.trySelectShape(event)
      : this.trySelectVertex(event);
  }

  trySelectShape(event: MouseEvent) {
    const canvasRect = this.canvas.getBoundingClientRect();
    const rectOffset = new Vector2(
      event.offsetX - canvasRect.x,
      event.offsetY - canvasRect.y
    );
    rectOffset.scaleX(1 / canvasRect.width);
    rectOffset.scaleY(1 / canvasRect.height);
    const normalizedCoord = new Vector2(
      (rectOffset.x - 0.5) * 2,
      (rectOffset.y - 0.5) * 2
    );
    normalizedCoord.scaleY(-1);

    let selectedShape = null;
    let minDistance = 2;
    for (const shape of this.shapes) {
      const shapeDistance = Vector2.distance(
        normalizedCoord,
        shape.transform.position
      );
      if (shapeDistance < minDistance) {
        selectedShape = shape;
        minDistance = shapeDistance;
      }
    }

    this.select(minDistance <= 0.1 ? selectedShape : null);
  }

  trySelectVertex(event: MouseEvent) {
    const canvasRect = this.canvas.getBoundingClientRect();
    const rectOffset = new Vector2(
      event.offsetX - canvasRect.x,
      event.offsetY - canvasRect.y
    );
    rectOffset.scaleX(1 / canvasRect.width);
    rectOffset.scaleY(1 / canvasRect.height);
    const normalizedCoord = new Vector2(
      (rectOffset.x - 0.5) * 2,
      (rectOffset.y - 0.5) * 2
    );
    normalizedCoord.scaleY(-1);

    let selectedVertex = null;
    let minDistance = 2;
    for (const vertex of this.selected.vertices) {
      const distance = Vector2.distance(normalizedCoord, vertex.globalCoord);
      if (distance < minDistance) {
        selectedVertex = vertex;
        minDistance = distance;
      }
    }

    this.selectVertex(minDistance <= 0.02 ? selectedVertex : null);
  }

  grabSelected() {
    let initialX: number;
    let initialY: number;
    let initialPosition: Vector2;
    window.addEventListener(
      "mousemove",
      (e: MouseEvent) => {
        initialX = e.clientX;
        initialY = e.clientY;
        initialPosition = this.selected.transform.position.clone();
      },
      {
        once: true,
      }
    );

    const setter: (_: MouseEvent) => any = (e: MouseEvent) => {
      if (!initialX || !initialY) return;
      const canvasRect = this.canvas.getBoundingClientRect();
      const delta = new Vector2(
        (e.clientX - initialX) / canvasRect.width,
        (initialY - e.clientY) / canvasRect.height
      );
      delta.scale(2);
      const newPosition = initialPosition.add(delta);
      this.selected.transform.position.set(newPosition);
      this.selected.update();
    };
    window.addEventListener("mousemove", setter);

    const stopper: (_: MouseEvent | KeyboardEvent) => any = (
      e: MouseEvent | KeyboardEvent
    ) => {
      if (e instanceof MouseEvent || (e as KeyboardEvent).code === "Escape") {
        window.removeEventListener("mousemove", setter);
        window.removeEventListener("keydown", stopper);
        window.removeEventListener("click", stopper);

        if (e instanceof KeyboardEvent) {
          this.selected.transform.position.set(initialPosition);
          this.selected.update();
        }
      }
    };
    window.addEventListener("keydown", stopper);
    window.addEventListener("click", stopper);
  }

  grabSelectedVertex() {
    let initialNormalizedCoord: Vector2;
    let initialPosition: Vector2;
    window.addEventListener(
      "mousemove",
      (e: MouseEvent) => {
        const screenCoord = new Vector2(e.clientX, e.clientY);
        initialNormalizedCoord = this.normalizeCoord(screenCoord);
        initialPosition = this.selectedVertex.position.clone();
      },
      {
        once: true,
      }
    );

    const setter: (_: MouseEvent) => any = (e: MouseEvent) => {
      if (!initialNormalizedCoord) return;
      const screenCoord = new Vector2(e.clientX, e.clientY);
      const normalizedCoord = this.normalizeCoord(screenCoord);
      this.selectedVertex.globalCoord = normalizedCoord;
    };
    window.addEventListener("mousemove", setter);

    const stopper: (_: MouseEvent | KeyboardEvent) => any = (
      e: MouseEvent | KeyboardEvent
    ) => {
      if (e instanceof MouseEvent || (e as KeyboardEvent).code === "Escape") {
        window.removeEventListener("mousemove", setter);
        window.removeEventListener("keydown", stopper);
        window.removeEventListener("click", stopper);

        if (e instanceof KeyboardEvent) {
          this.selectedVertex.position.set(initialPosition);
          this.selected.update();
        }
      }
    };
    window.addEventListener("keydown", stopper);
    window.addEventListener("click", stopper);
  }

  rotateSelected() {
    if (this.mode === "edit") return;

    let initialAngle: number;
    let initialRotation = this.selected.transform.rotation;
    const canvasRect = this.canvas.getBoundingClientRect();
    let selectedPos = this.selectedCoord.clone();
    selectedPos.scaleY(-1);
    selectedPos.scale(0.5);
    selectedPos.x += 0.5;
    selectedPos.y += 0.5;
    selectedPos.scaleX(canvasRect.width);
    selectedPos.scaleY(canvasRect.height);
    selectedPos.x += canvasRect.x;
    selectedPos.y += canvasRect.y;

    window.addEventListener(
      "mousemove",
      (e: MouseEvent) => {
        const initialPos = new Vector2(e.clientX, e.clientY);
        console.log(selectedPos);
        console.log(initialPos);
        // ? Negates because positive y is downwards
        initialAngle = -initialPos.sub(selectedPos).arc();
        console.log("initialAngle", (initialAngle * 180) / Math.PI);
      },
      {
        once: true,
      }
    );

    const setter: (_: MouseEvent) => any = (e: MouseEvent) => {
      if (!initialAngle) return;
      const currentPos = new Vector2(e.clientX, e.clientY);
      // ? Negates because positive y is downwards
      const angle = -currentPos.sub(selectedPos).arc();
      const diff = angle - initialAngle;
      this.selected.transform.rotation = initialRotation + diff;
    };
    window.addEventListener("mousemove", setter);

    const stopper: (_: MouseEvent | KeyboardEvent) => any = (
      e: MouseEvent | KeyboardEvent
    ) => {
      if (e instanceof MouseEvent || (e as KeyboardEvent).code === "Escape") {
        window.removeEventListener("mousemove", setter);
        window.removeEventListener("keydown", stopper);
        window.removeEventListener("click", stopper);

        if (e instanceof KeyboardEvent) {
          this.selected.transform.rotation = initialRotation;
        }
      }
    };
    window.addEventListener("keydown", stopper);
    window.addEventListener("click", stopper);
  }

  scaleSelected() {
    if (this.mode === "edit") return;

    let initialDistance: number;
    let initialScale = this.selected.transform.scale;
    const canvasRect = this.canvas.getBoundingClientRect();
    let selectedPos = this.selectedCoord.clone();
    selectedPos.scaleY(-1);
    selectedPos.scale(0.5);
    selectedPos.x += 0.5;
    selectedPos.y += 0.5;
    selectedPos.scaleX(canvasRect.width);
    selectedPos.scaleY(canvasRect.height);
    selectedPos.x += canvasRect.x;
    selectedPos.y += canvasRect.y;

    window.addEventListener(
      "mousemove",
      (e: MouseEvent) => {
        const initialPos = new Vector2(e.clientX, e.clientY);
        initialDistance = Vector2.distance(selectedPos, initialPos);
      },
      {
        once: true,
      }
    );

    const setter: (_: MouseEvent) => any = (e: MouseEvent) => {
      const currentPos = new Vector2(e.clientX, e.clientY);
      const distance = Vector2.distance(selectedPos, currentPos);
      const scale = distance / initialDistance;
      this.selected.transform.scale = initialScale * scale;
    };
    window.addEventListener("mousemove", setter);

    const stopper: (_: MouseEvent | KeyboardEvent) => any = (
      e: MouseEvent | KeyboardEvent
    ) => {
      if (e instanceof MouseEvent || (e as KeyboardEvent).code === "Escape") {
        window.removeEventListener("mousemove", setter);
        window.removeEventListener("keydown", stopper);
        window.removeEventListener("click", stopper);

        if (e instanceof KeyboardEvent) {
          this.selected.transform.scale = initialScale;
        }
      }
    };
    window.addEventListener("keydown", stopper);
    window.addEventListener("click", stopper);
  }

  get selectedCoord(): Vector2 {
    return this.selected?.transform.position;
  }

  start() {
    // TODO: Support vendor specific
    window.requestAnimationFrame(this.render.bind(this));
  }

  render() {
    this.context.clear(this.context.COLOR_BUFFER_BIT);
    for (const shape of this.shapes) {
      if (shape.isHidden) continue;

      const data = Array.from(shape.data);

      if (this.viewMode === "solid") {
        this.context.bufferData(
          this.context.ARRAY_BUFFER,
          new Float32Array(data),
          this.context.DYNAMIC_DRAW
        );

        this.context.drawArrays(
          shape.drawMode(this.context),
          0,
          data.length / VERTEX_SIZE
        );
      }

      if (this.viewMode === "wireframe") {
        this.drawOutline(data, shape, Color.black);
        shape.vertices.forEach((vertex) => this.drawPoint(vertex, Color.black));
      }

      if (shape === this.selected) {
        const highlightColor = this.mode === "object" ? ORANGE : Color.black;
        this.drawOutline(data, shape, highlightColor);
        shape.vertices.forEach((vertex) =>
          this.drawPoint(vertex, highlightColor)
        );
      }
    }

    if (this.mode === "edit" && this.selectedVertex) {
      this.drawPoint(this.selectedVertex, ORANGE);
    }

    window.requestAnimationFrame(this.render.bind(this));
  }

  drawOutline(verticesData: number[], shape: Shape, color: Vector3) {
    if (shape.drawMode(this.context) === this.context.TRIANGLES)
      verticesData = shape.vertices.map((v) => v.data).flat();

    const vertexCount = verticesData.length / VERTEX_SIZE;
    for (let i = 0; i < vertexCount; i++) {
      // R channel
      verticesData[VERTEX_SIZE * i + R] = color.x;
      // G channel
      verticesData[VERTEX_SIZE * i + G] = color.y;
      // B channel
      verticesData[VERTEX_SIZE * i + B] = color.z;
    }

    this.context.bufferData(
      this.context.ARRAY_BUFFER,
      new Float32Array(verticesData),
      this.context.DYNAMIC_DRAW
    );
    this.context.drawArrays(this.context.LINE_LOOP, 0, vertexCount);
  }

  drawPoint(vertex: Vertex, color: Vector3) {
    let data = vertex.data.flat();
    data[R] = color.x;
    data[G] = color.y;
    data[B] = color.z;

    // Actual vertex coords
    const position = new Vector2(data[0], data[1]);
    const parentPosition = new Vector2(
      data[PARENT_POSITION_INDEX],
      data[PARENT_POSITION_INDEX + 1]
    );
    const parentRotation = data[PARENT_ROTATION_INDEX];
    const parentScale = data[PARENT_SCALE_INDEX];
    position.scale(parentScale);
    position.rotate(parentRotation, Vector2.zero);
    const vertexCoord = parentPosition.add(position);

    let point = new Vector2(POINT_RADIUS, 0);
    for (let i = 0; i < 9; i++) {
      // ? Circle coordinates
      data.push(point.x, point.y);
      // ? Vertex color
      data.push(color.x, color.y, color.z);
      // ? Center (origin) coordinate
      data.push(vertexCoord.x, vertexCoord.y);
      // ? Rotation
      data.push((i * Math.PI) / 4);
      // ? Scale
      data.push(1);
    }

    this.context.bufferData(
      this.context.ARRAY_BUFFER,
      new Float32Array(data),
      this.context.DYNAMIC_DRAW
    );

    this.context.drawArrays(this.context.TRIANGLE_FAN, 0, 10);
  }

  select(object: Nullable<Shape>) {
    this.selectedVertex = null;
    for (const shape of this.shapes) {
      shape.isHighlighted = shape === object;
    }
    this.selected = object;
  }

  selectVertex(vertex: Nullable<Vertex>) {
    this.selectedVertex = vertex;
  }

  setViewMode(viewMode: ViewMode) {
    this.viewMode = viewMode;
  }

  switchViewMode() {
    this.viewMode = this.viewMode === "solid" ? "wireframe" : "solid";
  }

  switchMode() {
    if (this.mode === "object") {
      if (this.selected === null) return;
      this.mode = "edit";
      return;
    }
    this.mode = "object";
  }

  normalizeCoord(coord: Vector2) {
    const canvasRect = this.canvas.getBoundingClientRect();
    const rectOffset = new Vector2(
      coord.x - canvasRect.x,
      coord.y - canvasRect.y
    );
    rectOffset.scaleX(1 / canvasRect.width);
    rectOffset.scaleY(1 / canvasRect.height);
    const normalizedCoord = new Vector2(
      (rectOffset.x - 0.5) * 2,
      (rectOffset.y - 0.5) * 2
    );
    normalizedCoord.scaleY(-1);
    return normalizedCoord;
  }

  createDefaultLine(): Line {
    const lengthString = prompt("Line length: (default 0.4)");
    let length = parseFloat(lengthString);
    length = isNaN(length) ? 0.4 : length;
    length = length > 2 * Math.SQRT2 ? 0.4 : length;
    length = length <= 0 ? 0.4 : length;
    const line = new Line(Transform.origin, length);
    this.shapes.push(line);
    return line;
  }

  createDefaultSquare(): Square {
    const sizeString = prompt("Square size: (default 0.25)");
    let size = parseFloat(sizeString);
    size = isNaN(size) ? 0.25 : size;
    size = size > 2 ? 0.25 : size;
    size = size <= 0 ? 0.25 : size;
    const square = new Square(Transform.origin, size);
    this.shapes.push(square);
    return square;
  }

  createDefaultRectangle(): Rectangle {
    const lengthString = prompt("Rectangle length: (default 0.6)");
    let length = parseFloat(lengthString);
    length = isNaN(length) ? 0.6 : length;
    length = length > 2 ? 0.6 : length;
    length = length <= 0 ? 0.6 : length;

    const widthString = prompt("Rectangle width: (default 0.2)");
    let width = parseFloat(widthString);
    width = isNaN(width) ? 0.2 : width;
    width = width > 2 ? 0.2 : width;
    width = width <= 0 ? 0.2 : width;

    const rectangle = new Rectangle(Transform.origin, length, width);
    this.shapes.push(rectangle);
    return rectangle;
  }

  createDefaultPolygon(): Polygon {
    const sideString = prompt("Polygon sides: (default 5)");
    let side = parseInt(sideString);
    side = isNaN(side) ? 0.25 : side;
    side = side <= 2 ? 5 : side;

    const sizeString = prompt("Polygon size: (default 0.3)");
    let size = parseFloat(sizeString);
    size = isNaN(size) ? 0.25 : size;
    size = size > 2 ? 0.25 : size;
    size = size <= 0 ? 0.25 : size;

    const polygon = Polygon.regular(side, size);
    this.shapes.push(polygon);
    return polygon;
  }

  createSquare(transform: Transform, size: number): Square {
    const square = new Square(transform, size);
    this.shapes.push(square);
    return square;
  }

  createLine(transform: Transform, length: number): Line {
    const line = new Line(transform, length);
    this.shapes.push(line);
    return line;
  }

  createRectangle(
    transform: Transform,
    length: number,
    width: number
  ): Rectangle {
    const rect = new Rectangle(transform, length, width);
    this.shapes.push(rect);
    return rect;
  }

  createPolygon(transform: Transform): Polygon {
    const p = new Polygon(transform);
    this.shapes.push(p);
    return p;
  }
}

export { Viewer };
