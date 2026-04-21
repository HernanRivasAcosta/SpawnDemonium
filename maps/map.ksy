meta:
  id: map_format
  file-extension: map
  endian: le

enums:
  marker_type:
    1: player_spawn

seq:
  - id: width
    type: u2
    doc: Map width in tiles
  - id: height
    type: u2
    doc: Map height in tiles
  - id: num_markers
    type: u2
  - id: markers
    type: marker
    repeat: expr
    repeat-expr: num_markers
    doc: Markers are used to denote special points of interest on the map, such as spawn points
  - id: num_aabbs
    type: u2
  - id: aabbs
    type: aabb
    repeat: expr
    repeat-expr: num_aabbs
    doc: A minimal list of AABBs used for collision detection
  - id: num_floors
    type: u2
  - id: floors
    type: rect
    repeat: expr
    repeat-expr: num_floors
    doc: |
      A minimal list of rectangles covering the floor tiles, the hitboxes on the floor are
      not subtracted


types:
  marker:
    seq:
      - id: kind
        type: u1
        enum: marker_type
        doc: The type of marker
      - id: x
        type: u2
        doc: The x coordinate of the marker
      - id: y
        type: u2
        doc: The y coordinate of the marker
  aabb:
    doc: Axis-aligned bounding box in world-space pixels
    seq:
      - id: x
        type: u2
        doc: The left of the AABB
      - id: y
        type: u2
        doc: The top of the AABB
      - id: w
        type: u2
        doc: The AABB width
      - id: h
        type: u2
        doc: The AABB height
      - id: wall
        type: b1
        doc: Whether this AABB is a wall (meaning it stops bullets)
  rect:
    doc: Rectangle in world-space pixels
    seq:
      - id: x
        type: u2
        doc: The left of the rectangle
      - id: y
        type: u2
        doc: The top of the rectangle
      - id: w
        type: u2
        doc: The rectangle width
      - id: h
        type: u2
        doc: The rectangle height

