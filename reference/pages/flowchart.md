<!-- Source: https://mermaid.js.org/syntax/flowchart.html -->
<!-- License: MIT (Mermaid documentation) -->

# Flowchart

> Offline mirror for NerdGram1337. Upstream: [https://mermaid.js.org/syntax/flowchart.html](https://mermaid.js.org/syntax/flowchart.html)

# Flowcharts - Basic Syntax [​](#flowcharts-basic-syntax)

Flowcharts are composed of **nodes** (geometric shapes) and **edges** (arrows or lines). The Mermaid code defines how nodes and edges are made and accommodates different arrow types, multi-directional arrows, and any linking to and from subgraphs.

WARNING

If you are using the word "end" in a Flowchart node, capitalize the entire word or any of the letters (e.g., "End" or "END"), or apply this [workaround](https://github.com/mermaid-js/mermaid/issues/1444#issuecomment-639528897). Typing "end" in all lowercase letters will break the Flowchart.

WARNING

If you are using the letter "o" or "x" as the first letter in a connecting Flowchart node, add a space before the letter or capitalize the letter (e.g., "dev--- ops", "dev---Ops").

Typing "A---oB" will create a [circle edge](#circle-edge-example).

Typing "A---xB" will create a [cross edge](#cross-edge-example).

### A node (default) [​](#a-node-default)

##### Code:

mermaid

```
---
title: Node
---
flowchart LR
    id
```

Ctrl + Enter|Run ▶

INFO

The id is what is displayed in the box.

TIP

Instead of `flowchart` one can also use `graph`.

### A node with text [​](#a-node-with-text)

It is also possible to set text in the box that differs from the id. If this is done several times, it is the last text found for the node that will be used. Also if you define edges for the node later on, you can omit text definitions. The one previously defined will be used when rendering the box.

##### Code:

mermaid

```
---
title: Node with text
---
flowchart LR
    id1[This is the text in the box]
```

Ctrl + Enter|Run ▶

#### Unicode text [​](#unicode-text)

Use `"` to enclose the unicode text.

##### Code:

mermaid

```
flowchart LR
    id["This ❤ Unicode"]
```

Ctrl + Enter|Run ▶

#### Markdown formatting [​](#markdown-formatting)

Use double quotes and backticks "\` text \`" to enclose the markdown text.

##### Code:

mermaid

```
---
config:
  htmlLabels: false
---
flowchart LR
    markdown["`This **is** _Markdown_`"]
    newLines["`Line1
    Line 2
    Line 3`"]
    markdown --> newLines
```

Ctrl + Enter|Run ▶

### Direction [​](#direction)

This statement declares the direction of the Flowchart.

This declares the flowchart is oriented from top to bottom (`TD` or `TB`).

##### Code:

mermaid

```
flowchart TD
    Start --> Stop
```

Ctrl + Enter|Run ▶

This declares the flowchart is oriented from left to right (`LR`).

##### Code:

mermaid

```
flowchart LR
    Start --> Stop
```

Ctrl + Enter|Run ▶

Possible FlowChart orientations are:

-   TB - Top to bottom
-   TD - Top-down/ same as top to bottom
-   BT - Bottom to top
-   RL - Right to left
-   LR - Left to right

## Default theme, look and layout (v12.0.0+) [​](#default-theme-look-and-layout-v12-0-0)

Flowcharts use the `redux-color` theme and the `neo` look by default, and are laid out by [ELK](https://www.eclipse.org/elk/) rather than Dagre. Not every diagram type does — see [Per-diagram defaults](https://mermaid.js.org/config/theming.html#per-diagram-defaults) for the list and for the order in which Mermaid decides.

The same diagram, drawn both ways:

### With the defaults [​](#with-the-defaults)

##### Code:

mermaid

```
flowchart LR
  subgraph Client
    UI[Web app]
    Cache[(Local cache)]
  end
  subgraph Services
    API[API gateway]
    Auth[Auth service]
    Orders[Order service]
  end
  subgraph Storage
    DB[(Orders DB)]
  end
  UI --> API
  UI --> Cache
  API --> Auth
  API --> Orders
  Orders --> DB
  Auth -. token .-> UI
```

Ctrl + Enter|Run ▶

### The previous appearance [​](#the-previous-appearance)

Both are only defaults, so anything you set yourself wins. Naming the previous theme and look in a diagram's front matter draws it the way Mermaid did before:

##### Code:

mermaid

```
---
config:
  theme: default
  look: classic
  layout: dagre
---
flowchart LR
  subgraph Client
    UI[Web app]
    Cache[(Local cache)]
  end
  subgraph Services
    API[API gateway]
    Auth[Auth service]
    Orders[Order service]
  end
  subgraph Storage
    DB[(Orders DB)]
  end
  UI --> API
  UI --> Cache
  API --> Auth
  API --> Orders
  Orders --> DB
  Auth -. token .-> UI
```

Ctrl + Enter|Run ▶

Passing the same three keys to `mermaid.initialize()` does it for every diagram on the page, and scoping the theme and look to one diagram type — `mermaid.initialize({ layout: 'dagre', flowchart: { theme: 'default', look: 'classic' } })` — does it for that type alone. `layout` is a top-level option, so it applies to every diagram.

## Node shapes [​](#node-shapes)

### A node with round edges [​](#a-node-with-round-edges)

##### Code:

mermaid

```
flowchart LR
    id1(This is the text in the box)
```

Ctrl + Enter|Run ▶

### A stadium-shaped node [​](#a-stadium-shaped-node)

##### Code:

mermaid

```
flowchart LR
    id1([This is the text in the box])
```

Ctrl + Enter|Run ▶

### A node in a subroutine shape [​](#a-node-in-a-subroutine-shape)

##### Code:

mermaid

```
flowchart LR
    id1[[This is the text in the box]]
```

Ctrl + Enter|Run ▶

### A node in a cylindrical shape [​](#a-node-in-a-cylindrical-shape)

##### Code:

mermaid

```
flowchart LR
    id1[(Database)]
```

Ctrl + Enter|Run ▶

### A node in the form of a circle [​](#a-node-in-the-form-of-a-circle)

##### Code:

mermaid

```
flowchart LR
    id1((This is the text in the circle))
```

Ctrl + Enter|Run ▶

### A node in an asymmetric shape [​](#a-node-in-an-asymmetric-shape)

##### Code:

mermaid

```
flowchart LR
    id1>This is the text in the box]
```

Ctrl + Enter|Run ▶

Currently only the shape above is possible and not its mirror. _This might change with future releases._

### A node (rhombus) [​](#a-node-rhombus)

##### Code:

mermaid

```
flowchart LR
    id1{This is the text in the box}
```

Ctrl + Enter|Run ▶

### A hexagon node [​](#a-hexagon-node)

##### Code:

mermaid

```
flowchart LR
    id1{{This is the text in the box}}
```

Ctrl + Enter|Run ▶

### Parallelogram [​](#parallelogram)

##### Code:

mermaid

```
flowchart TD
    id1[/This is the text in the box/]
```

Ctrl + Enter|Run ▶

### Parallelogram alt [​](#parallelogram-alt)

##### Code:

mermaid

```
flowchart TD
    id1[\This is the text in the box\]
```

Ctrl + Enter|Run ▶

### Trapezoid [​](#trapezoid)

##### Code:

mermaid

```
flowchart TD
    A[/Christmas\]
```

Ctrl + Enter|Run ▶

### Trapezoid alt [​](#trapezoid-alt)

##### Code:

mermaid

```
flowchart TD
    B[\Go shopping/]
```

Ctrl + Enter|Run ▶

### Double circle [​](#double-circle)

##### Code:

mermaid

```
flowchart TD
    id1(((This is the text in the circle)))
```

Ctrl + Enter|Run ▶

## Expanded Node Shapes in Mermaid Flowcharts (v11.3.0+) [​](#expanded-node-shapes-in-mermaid-flowcharts-v11-3-0)

Mermaid introduces 30 new shapes to enhance the flexibility and precision of flowchart creation. These new shapes provide more options to represent processes, decisions, events, data storage visually, and other elements within your flowcharts, improving clarity and semantic meaning.

New Syntax for Shape Definition

Mermaid now supports a general syntax for defining shape types to accommodate the growing number of shapes. This syntax allows you to assign specific shapes to nodes using a clear and flexible format:

```
A@{ shape: rect }
```

This syntax creates a node A as a rectangle. It renders in the same way as `A["A"]`, or `A`.

### Complete List of New Shapes [​](#complete-list-of-new-shapes)

Below is a comprehensive list of the newly introduced shapes and their corresponding semantic meanings, short names, and aliases:

**Semantic Name**

**Shape Name**

**Short Name**

**Description**

**Alias Supported**

Bang

Bang

`bang`

Bang

`bang`

Browser

Browser

`browser`

Browser window

Bucket

Bucket

`bucket`

Object storage bucket

Card

Notched Rectangle

`notch-rect`

Represents a card

`card`, `notched-rectangle`

Cloud

Cloud

`cloud`

cloud

`cloud`

Collate

Hourglass

`hourglass`

Represents a collate operation

`collate`, `hourglass`

Com Link

Lightning Bolt

`bolt`

Communication link

`com-link`, `lightning-bolt`

Comment

Curly Brace

`brace`

Adds a comment

`brace-l`, `comment`

Comment Right

Curly Brace

`brace-r`

Adds a comment

Comment with braces on both sides

Curly Braces

`braces`

Adds a comment

Console

Console (terminal window)

`console`

Terminal or console window

Data Input/Output

Lean Right

`lean-r`

Represents input or output

`in-out`, `lean-right`

Data Input/Output

Lean Left

`lean-l`

Represents output or input

`lean-left`, `out-in`

Data Store

Data Store

`datastore`

Data flow diagram data store

`data-store`

Database

Cylinder

`cyl`

Database storage

`cylinder`, `database`, `db`

Decision

Diamond

`diam`

Decision-making step

`decision`, `diamond`, `question`

Delay

Half-Rounded Rectangle

`delay`

Represents a delay

`half-rounded-rectangle`

Direct Access Storage

Horizontal Cylinder

`h-cyl`

Direct access storage

`das`, `horizontal-cylinder`

Disk Storage

Lined Cylinder

`lin-cyl`

Disk storage

`disk`, `lined-cylinder`

Display

Curved Trapezoid

`curv-trap`

Represents a display

`curved-trapezoid`, `display`

Divided Process

Divided Rectangle

`div-rect`

Divided process shape

`div-proc`, `divided-process`, `divided-rectangle`

Document

Document

`doc`

Represents a document

`doc`, `document`

Event

Rounded Rectangle

`rounded`

Represents an event

`event`

Extract

Triangle

`tri`

Extraction process

`extract`, `triangle`

Folder

Folder

`folder`

Folder or directory

`directory`

Fork/Join

Filled Rectangle

`fork`

Fork or join in process flow

`join`

Internal Storage

Window Pane

`win-pane`

Internal storage

`internal-storage`, `window-pane`

Junction

Filled Circle

`f-circ`

Junction point

`filled-circle`, `junction`

Lined Document

Lined Document

`lin-doc`

Lined document

`lined-document`

Lined/Shaded Process

Lined Rectangle

`lin-rect`

Lined process shape

`lin-proc`, `lined-process`, `lined-rectangle`, `shaded-process`

Loop Limit

Trapezoidal Pentagon

`notch-pent`

Loop limit step

`loop-limit`, `notched-pentagon`

Manual File

Flipped Triangle

`flip-tri`

Manual file operation

`flipped-triangle`, `manual-file`

Manual Input

Sloped Rectangle

`sl-rect`

Manual input step

`manual-input`, `sloped-rectangle`

Manual Operation

Trapezoid Base Top

`trap-t`

Represents a manual task

`inv-trapezoid`, `manual`, `trapezoid-top`

Multi-Document

Stacked Document

`docs`

Multiple documents

`documents`, `st-doc`, `stacked-document`

Multi-Process

Stacked Rectangle

`st-rect`

Multiple processes

`processes`, `procs`, `stacked-rectangle`

Odd

Odd

`odd`

Odd shape

Paper Tape

Flag

`flag`

Paper tape

`paper-tape`

Person

Person

`person`

Person (circular head above a rounded body)

Prepare Conditional

Hexagon

`hex`

Preparation or condition step

`hexagon`, `prepare`

Priority Action

Trapezoid Base Bottom

`trap-b`

Priority action

`priority`, `trapezoid`, `trapezoid-bottom`

Process

Rectangle

`rect`

Standard process shape

`proc`, `process`, `rectangle`

Start

Circle

`circle`

Starting point

`circ`

Start

Small Circle

`sm-circ`

Small starting point

`small-circle`, `start`

Stop

Double Circle

`dbl-circ`

Represents a stop point

`double-circle`

Stop

Framed Circle

`fr-circ`

Stop point

`framed-circle`, `stop`

Stored Data

Bow Tie Rectangle

`bow-rect`

Stored data

`bow-tie-rectangle`, `stored-data`

Subprocess

Framed Rectangle

`fr-rect`

Subprocess

`framed-rectangle`, `subproc`, `subprocess`, `subroutine`

Summary

Crossed Circle

`cross-circ`

Summary

`crossed-circle`, `summary`

Tagged Document

Tagged Document

`tag-doc`

Tagged document

`tag-doc`, `tagged-document`

Tagged Process

Tagged Rectangle

`tag-rect`

Tagged process

`tag-proc`, `tagged-process`, `tagged-rectangle`

Terminal Point

Stadium

`stadium`

Terminal point

`pill`, `terminal`

Text Block

Text Block

`text`

Text block

### Example Flowchart with New Shapes [​](#example-flowchart-with-new-shapes)

Here’s an example flowchart that utilizes some of the newly introduced shapes:

##### Code:

mermaid

```
flowchart RL
    A@{ shape: manual-file, label: "File Handling"}
    B@{ shape: manual-input, label: "User Input"}
    C@{ shape: docs, label: "Multiple Documents"}
    D@{ shape: procs, label: "Process Automation"}
    E@{ shape: paper-tape, label: "Paper Records"}
```

Ctrl + Enter|Run ▶

### Process [​](#process)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: rect, label: "This is a process" }
```

Ctrl + Enter|Run ▶

### Event [​](#event)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: rounded, label: "This is an event" }
```

Ctrl + Enter|Run ▶

### Terminal Point (Stadium) [​](#terminal-point-stadium)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: stadium, label: "Terminal point" }
```

Ctrl + Enter|Run ▶

### Subprocess [​](#subprocess)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: subproc, label: "This is a subprocess" }
```

Ctrl + Enter|Run ▶

### Database (Cylinder) [​](#database-cylinder)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: cyl, label: "Database" }
```

Ctrl + Enter|Run ▶

### Start (Circle) [​](#start-circle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: circle, label: "Start" }
```

Ctrl + Enter|Run ▶

### Odd [​](#odd)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: odd, label: "Odd shape" }
```

Ctrl + Enter|Run ▶

### Decision (Diamond) [​](#decision-diamond)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: diamond, label: "Decision" }
```

Ctrl + Enter|Run ▶

### Prepare Conditional (Hexagon) [​](#prepare-conditional-hexagon)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: hex, label: "Prepare conditional" }
```

Ctrl + Enter|Run ▶

### Data Input/Output (Lean Right) [​](#data-input-output-lean-right)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: lean-r, label: "Input/Output" }
```

Ctrl + Enter|Run ▶

### Data Input/Output (Lean Left) [​](#data-input-output-lean-left)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: lean-l, label: "Output/Input" }
```

Ctrl + Enter|Run ▶

### Datastore (Top and bottom border) [​](#datastore-top-and-bottom-border)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: datastore, label: "Datastore" }
```

Ctrl + Enter|Run ▶

### Priority Action (Trapezoid Base Bottom) [​](#priority-action-trapezoid-base-bottom)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: trap-b, label: "Priority action" }
```

Ctrl + Enter|Run ▶

### Manual Operation (Trapezoid Base Top) [​](#manual-operation-trapezoid-base-top)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: trap-t, label: "Manual operation" }
```

Ctrl + Enter|Run ▶

### Stop (Double Circle) [​](#stop-double-circle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: dbl-circ, label: "Stop" }
```

Ctrl + Enter|Run ▶

### Text Block [​](#text-block)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: text, label: "This is a text block" }
```

Ctrl + Enter|Run ▶

### Card (Notched Rectangle) [​](#card-notched-rectangle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: notch-rect, label: "Card" }
```

Ctrl + Enter|Run ▶

### Lined/Shaded Process [​](#lined-shaded-process)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: lin-rect, label: "Lined process" }
```

Ctrl + Enter|Run ▶

### Start (Small Circle) [​](#start-small-circle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: sm-circ, label: "Small start" }
```

Ctrl + Enter|Run ▶

### Stop (Framed Circle) [​](#stop-framed-circle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: framed-circle, label: "Stop" }
```

Ctrl + Enter|Run ▶

### Fork/Join (Long Rectangle) [​](#fork-join-long-rectangle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: fork, label: "Fork or Join" }
```

Ctrl + Enter|Run ▶

### Collate (Hourglass) [​](#collate-hourglass)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: hourglass, label: "Collate" }
```

Ctrl + Enter|Run ▶

### Comment (Curly Brace) [​](#comment-curly-brace)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: comment, label: "Comment" }
```

Ctrl + Enter|Run ▶

### Comment Right (Curly Brace Right) [​](#comment-right-curly-brace-right)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: brace-r, label: "Comment" }
```

Ctrl + Enter|Run ▶

### Comment with braces on both sides [​](#comment-with-braces-on-both-sides)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: braces, label: "Comment" }
```

Ctrl + Enter|Run ▶

### Com Link (Lightning Bolt) [​](#com-link-lightning-bolt)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: bolt, label: "Communication link" }
```

Ctrl + Enter|Run ▶

### Document [​](#document)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: doc, label: "Document" }
```

Ctrl + Enter|Run ▶

### Delay (Half-Rounded Rectangle) [​](#delay-half-rounded-rectangle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: delay, label: "Delay" }
```

Ctrl + Enter|Run ▶

### Direct Access Storage (Horizontal Cylinder) [​](#direct-access-storage-horizontal-cylinder)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: das, label: "Direct access storage" }
```

Ctrl + Enter|Run ▶

### Disk Storage (Lined Cylinder) [​](#disk-storage-lined-cylinder)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: lin-cyl, label: "Disk storage" }
```

Ctrl + Enter|Run ▶

### Display (Curved Trapezoid) [​](#display-curved-trapezoid)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: curv-trap, label: "Display" }
```

Ctrl + Enter|Run ▶

### Divided Process (Divided Rectangle) [​](#divided-process-divided-rectangle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: div-rect, label: "Divided process" }
```

Ctrl + Enter|Run ▶

### Extract (Small Triangle) [​](#extract-small-triangle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: tri, label: "Extract" }
```

Ctrl + Enter|Run ▶

### Internal Storage (Window Pane) [​](#internal-storage-window-pane)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: win-pane, label: "Internal storage" }
```

Ctrl + Enter|Run ▶

### Junction (Filled Circle) [​](#junction-filled-circle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: f-circ, label: "Junction" }
```

Ctrl + Enter|Run ▶

### Lined Document [​](#lined-document)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: lin-doc, label: "Lined document" }
```

Ctrl + Enter|Run ▶

### Loop Limit (Notched Pentagon) [​](#loop-limit-notched-pentagon)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: notch-pent, label: "Loop limit" }
```

Ctrl + Enter|Run ▶

### Manual File (Flipped Triangle) [​](#manual-file-flipped-triangle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: flip-tri, label: "Manual file" }
```

Ctrl + Enter|Run ▶

### Manual Input (Sloped Rectangle) [​](#manual-input-sloped-rectangle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: sl-rect, label: "Manual input" }
```

Ctrl + Enter|Run ▶

### Multi-Document (Stacked Document) [​](#multi-document-stacked-document)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: docs, label: "Multiple documents" }
```

Ctrl + Enter|Run ▶

### Multi-Process (Stacked Rectangle) [​](#multi-process-stacked-rectangle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: processes, label: "Multiple processes" }
```

Ctrl + Enter|Run ▶

### Paper Tape (Flag) [​](#paper-tape-flag)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: flag, label: "Paper tape" }
```

Ctrl + Enter|Run ▶

### Stored Data (Bow Tie Rectangle) [​](#stored-data-bow-tie-rectangle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: bow-rect, label: "Stored data" }
```

Ctrl + Enter|Run ▶

### Summary (Crossed Circle) [​](#summary-crossed-circle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: cross-circ, label: "Summary" }
```

Ctrl + Enter|Run ▶

### Tagged Document [​](#tagged-document)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: tag-doc, label: "Tagged document" }
```

Ctrl + Enter|Run ▶

### Tagged Process (Tagged Rectangle) [​](#tagged-process-tagged-rectangle)

##### Code:

mermaid

```
flowchart TD
    A@{ shape: tag-rect, label: "Tagged process" }
```

Ctrl + Enter|Run ▶

## Special shapes in Mermaid Flowcharts (v11.3.0+) [​](#special-shapes-in-mermaid-flowcharts-v11-3-0)

Mermaid also introduces 2 special shapes to enhance your flowcharts: **icon** and **image**. These shapes allow you to include icons and images directly within your flowcharts, providing more visual context and clarity.

### Icon Shape [​](#icon-shape)

You can use the `icon` shape to include an icon in your flowchart. To use icons, you need to register the icon pack first. Follow the instructions to [add custom icons](https://mermaid.js.org/config/icons.html). The syntax for defining an icon shape is as follows:

##### Code:

mermaid

```
flowchart TD
    A@{ icon: "fa:user", form: "square", label: "User Icon", pos: "t", h: 60 }
```

Ctrl + Enter|Run ▶

#### Parameters [​](#parameters)

-   **icon**: The name of the icon from the registered icon pack.
-   **form**: Specifies the background shape of the icon. If not defined there will be no background to icon. Options include:
    -   `square`
    -   `circle`
    -   `rounded`
-   **label**: The text label associated with the icon. This can be any string. If not defined, no label will be displayed.
-   **pos**: The position of the label. If not defined label will default to bottom of icon. Possible values are:
    -   `t`
    -   `b`
-   **h**: The height of the icon. If not defined this will default to 48 which is minimum.

### Image Shape [​](#image-shape)

You can use the `image` shape to include an image in your flowchart. The syntax for defining an image shape is as follows:

```
flowchart TD
    A@{ img: "https://example.com/image.png", label: "Image Label", pos: "t", w: 60, h: 60, constraint: "off" }
```

#### Parameters [​](#parameters-1)

-   **img**: The URL of the image to be displayed.
-   **label**: The text label associated with the image. This can be any string. If not defined, no label will be displayed.
-   **pos**: The position of the label. If not defined, the label will default to the bottom of the image. Possible values are:
    -   `t`
    -   `b`
-   **w**: The width of the image. If not defined, this will default to the natural width of the image.
-   **h**: The height of the image. If not defined, this will default to the natural height of the image.
-   **constraint**: Determines if the image should constrain the node size. This setting also ensures the image maintains its original aspect ratio, adjusting the width (`w`) accordingly to the height (`h`). If not defined, this will default to `off` Possible values are:
    -   `on`
    -   `off`

If you want to resize an image, but keep the same aspect ratio, set `h`, and set `constraint: on` to constrain the aspect ratio. E.g.

##### Code:

mermaid

```
flowchart TD
  %% My image with a constrained aspect ratio
  A@{ img: "https://mermaid.js.org/favicon.svg", label: "My example image label", pos: "t", h: 60, constraint: "on" }
```

Ctrl + Enter|Run ▶

## Links between nodes [​](#links-between-nodes)

Nodes can be connected with links/edges. It is possible to have different types of links or attach a text string to a link.

### A link with arrow head [​](#a-link-with-arrow-head)

##### Code:

mermaid

```
flowchart LR
    A-->B
```

Ctrl + Enter|Run ▶

### An open link [​](#an-open-link)

##### Code:

mermaid

```
flowchart LR
    A --- B
```

Ctrl + Enter|Run ▶

### Text on links [​](#text-on-links)

##### Code:

mermaid

```
flowchart LR
    A-- This is the text! ---B
```

Ctrl + Enter|Run ▶

or

##### Code:

mermaid

```
flowchart LR
    A---|This is the text|B
```

Ctrl + Enter|Run ▶

### A link with arrow head and text [​](#a-link-with-arrow-head-and-text)

##### Code:

mermaid

```
flowchart LR
    A-->|text|B
```

Ctrl + Enter|Run ▶

or

##### Code:

mermaid

```
flowchart LR
    A-- text -->B
```

Ctrl + Enter|Run ▶

### Dotted link [​](#dotted-link)

##### Code:

mermaid

```
flowchart LR
   A-.->B;
```

Ctrl + Enter|Run ▶

### Dotted link with text [​](#dotted-link-with-text)

##### Code:

mermaid

```
flowchart LR
   A-. text .-> B
```

Ctrl + Enter|Run ▶

### Thick link [​](#thick-link)

##### Code:

mermaid

```
flowchart LR
   A ==> B
```

Ctrl + Enter|Run ▶

### Thick link with text [​](#thick-link-with-text)

##### Code:

mermaid

```
flowchart LR
   A == text ==> B
```

Ctrl + Enter|Run ▶

### An invisible link [​](#an-invisible-link)

This can be a useful tool in some instances where you want to alter the default positioning of a node.

##### Code:

mermaid

```
flowchart LR
    A ~~~ B
```

Ctrl + Enter|Run ▶

### Chaining of links [​](#chaining-of-links)

It is possible declare many links in the same line as per below:

##### Code:

mermaid

```
flowchart LR
   A -- text --> B -- text2 --> C
```

Ctrl + Enter|Run ▶

It is also possible to declare multiple nodes links in the same line as per below:

##### Code:

mermaid

```
flowchart LR
   a --> b & c--> d
```

Ctrl + Enter|Run ▶

You can then describe dependencies in a very expressive way. Like the one-liner below:

##### Code:

mermaid

```
flowchart TB
    A & B--> C & D
```

Ctrl + Enter|Run ▶

If you describe the same diagram using the basic syntax, it will take four lines. A word of warning, one could go overboard with this making the flowchart harder to read in markdown form. The Swedish word `lagom` comes to mind. It means, not too much and not too little. This goes for expressive syntaxes as well.

##### Code:

mermaid

```
flowchart TB
    A --> C
    A --> D
    B --> C
    B --> D
```

Ctrl + Enter|Run ▶

### Attaching an ID to Edges [​](#attaching-an-id-to-edges)

Mermaid now supports assigning IDs to edges, similar to how IDs and metadata can be attached to nodes. This feature lays the groundwork for more advanced styling, classes, and animation capabilities on edges.

**Syntax:**

To give an edge an ID, prepend the edge syntax with the ID followed by an `@` character. For example:

##### Code:

mermaid

```
flowchart LR
  A e1@--> B
```

Ctrl + Enter|Run ▶

In this example, `e1` is the ID of the edge connecting `A` to `B`. You can then use this ID in later definitions or style statements, just like with nodes.

### Turning an Animation On [​](#turning-an-animation-on)

Once you have assigned an ID to an edge, you can turn on animations for that edge by defining the edge’s properties:

##### Code:

mermaid

```
flowchart LR
  A e1@==> B
  e1@{ animate: true }
```

Ctrl + Enter|Run ▶

This tells Mermaid that the edge `e1` should be animated.

### Selecting Type of Animation [​](#selecting-type-of-animation)

In the initial version, two animation speeds are supported: `fast` and `slow`. Selecting a specific animation type is a shorthand for enabling animation and setting the animation speed in one go.

**Examples:**

##### Code:

mermaid

```
flowchart LR
  A e1@--> B
  e1@{ animation: fast }
```

Ctrl + Enter|Run ▶

This is equivalent to `{ animate: true, animation: fast }`.

### Using classDef Statements for Animations [​](#using-classdef-statements-for-animations)

You can also animate edges by assigning a class to them and then defining animation properties in a `classDef` statement. For example:

##### Code:

mermaid

```
flowchart LR
  A e1@--> B
  classDef animate stroke-dasharray: 9,5,stroke-dashoffset: 900,animation: dash 25s linear infinite;
  class e1 animate
```

Ctrl + Enter|Run ▶

In this snippet:

-   `e1@-->` creates an edge with ID `e1`.
-   `classDef animate` defines a class named `animate` with styling and animation properties.
-   `class e1 animate` applies the `animate` class to the edge `e1`.

**Note on Escaping Commas:** When setting the `stroke-dasharray` property, remember to escape commas as `\,` since commas are used as delimiters in Mermaid’s style definitions.

### Step-by-step flow animation (v12.3.0+) [​](#step-by-step-flow-animation-v12-3-0)

Edges can also play in order, which is handy for showing how a request moves through a system. Give an edge a `step` number and a dot travels along it when that step comes up. The dot visits step 1, then step 2, and so on, and starts again after the last step. Edges that share a step number play at the same time.

##### Code:

mermaid

```
flowchart LR
  Client e1@--> API
  API e2@--> Cache
  Cache e3@-->|miss| DB
  DB e4@--> API
  API e5@--> Client
  e1@{ step: 1 }
  e2@{ step: 2 }
  e3@{ step: 3 }
  e4@{ step: 4 }
  e5@{ step: 5 }
```

Ctrl + Enter|Run ▶

-   Edges without a `step` are drawn as usual, so a diagram with no `step` looks exactly as before.
-   While its dot travels, the edge is highlighted with a thicker stroke in the edge's colour (v12.3.0+). The highlight has the class `edge-step-highlight`, so it can be restyled with `themeCSS`.
-   Set `flowchart.stepNumbers: true` (v12.3.0+) to show each edge's step number in a small badge, so the order can be read without watching the animation, in print, or when motion is reduced. It is off by default. The badge sits on the edge clear of labels, nodes, arrowheads and other badges (just beside the edge when it is too short), and is drawn above every edge and moving dot. The badge has the class `edge-step-badge`, so it can be restyled with `themeCSS`. Its size is fixed in diagram units, so when the diagram is scaled down to fit its container (`useMaxWidth`) the badge shrinks with it; set `flowchart.useMaxWidth: false` to keep it full size.
-   `step` must be a positive whole number (`1`, `2`, `3`, ...). Other values are ignored.
-   Each step lasts one second by default. Set `flowchart.stepDuration` (in seconds, v12.3.0+) to make the flow faster or slower:

##### Code:

mermaid

```
---
config:
  flowchart:
    stepDuration: 0.5
---
flowchart LR
  Client e1@--> API
  API e2@--> Client
  e1@{ step: 1 }
  e2@{ step: 2 }
```

Ctrl + Enter|Run ▶

-   When the reader's system asks for reduced motion (`prefers-reduced-motion: reduce`), the dot and the highlight are hidden and the diagram is static.
-   `step` can be combined with `animate` or `animation` if you also want the edge's dashes to move.

## New arrow types [​](#new-arrow-types)

There are new types of arrows supported:

-   circle edge
-   cross edge

### Circle edge example [​](#circle-edge-example)

##### Code:

mermaid

```
flowchart LR
    A --o B
```

Ctrl + Enter|Run ▶

### Cross edge example [​](#cross-edge-example)

##### Code:

mermaid

```
flowchart LR
    A --x B
```

Ctrl + Enter|Run ▶

## Multi directional arrows [​](#multi-directional-arrows)

There is the possibility to use multidirectional arrows.

##### Code:

mermaid

```
flowchart LR
    A o--o B
    B <--> C
    C x--x D
```

Ctrl + Enter|Run ▶

### Minimum length of a link [​](#minimum-length-of-a-link)

Each node in the flowchart is ultimately assigned to a rank in the rendered graph, i.e. to a vertical or horizontal level (depending on the flowchart orientation), based on the nodes to which it is linked. By default, links can span any number of ranks, but you can ask for any link to be longer than the others by adding extra dashes in the link definition.

In the following example, two extra dashes are added in the link from node _B_ to node _E_, so that it spans two more ranks than regular links:

##### Code:

mermaid

```
flowchart TD
    A[Start] --> B{Is it?}
    B -->|Yes| C[OK]
    C --> D[Rethink]
    D --> B
    B ---->|No| E[End]
```

Ctrl + Enter|Run ▶

> **Note** Links may still be made longer than the requested number of ranks by the rendering engine to accommodate other requests.

When the link label is written in the middle of the link, the extra dashes must be added on the right side of the link. The following example is equivalent to the previous one:

##### Code:

mermaid

```
flowchart TD
    A[Start] --> B{Is it?}
    B -- Yes --> C[OK]
    C --> D[Rethink]
    D --> B
    B -- No ----> E[End]
```

Ctrl + Enter|Run ▶

For dotted or thick links, the characters to add are equals signs or dots, as summed up in the following table:

Length

1

2

3

Normal

`---`

`----`

`-----`

Normal with arrow

`-->`

`--->`

`---->`

Thick

`===`

`====`

`=====`

Thick with arrow

`==>`

`===>`

`====>`

Dotted

`-.-`

`-..-`

`-...-`

Dotted with arrow

`-.->`

`-..->`

`-...->`

## Special characters that break syntax [​](#special-characters-that-break-syntax)

It is possible to put text within quotes in order to render more troublesome characters. As in the example below:

##### Code:

mermaid

```
flowchart LR
    id1["This is the (text) in the box"]
```

Ctrl + Enter|Run ▶

### Entity codes to escape characters [​](#entity-codes-to-escape-characters)

It is possible to escape characters using the syntax exemplified here.

##### Code:

mermaid

```
    flowchart LR
        A["A double quote:#quot;"] --> B["A dec char:#9829;"]
```

Ctrl + Enter|Run ▶

Numbers given are base 10, so `#` can be encoded as `#35;`. It is also supported to use HTML character names.

## Subgraphs [​](#subgraphs)

```
subgraph title
    graph definition
end
```

An example below:

##### Code:

mermaid

```
flowchart TB
    c1-->a2
    subgraph one
    a1-->a2
    end
    subgraph two
    b1-->b2
    end
    subgraph three
    c1-->c2
    end
```

Ctrl + Enter|Run ▶

You can also set an explicit id for the subgraph.

##### Code:

mermaid

```
flowchart TB
    c1-->a2
    subgraph ide1 [one]
    a1-->a2
    end
```

Ctrl + Enter|Run ▶

### flowcharts [​](#flowcharts)

With the graphtype flowchart it is also possible to set edges to and from subgraphs as in the flowchart below.

##### Code:

mermaid

```
flowchart TB
    c1-->a2
    subgraph one
    a1-->a2
    end
    subgraph two
    b1-->b2
    end
    subgraph three
    c1-->c2
    end
    one --> two
    three --> two
    two --> c2
```

Ctrl + Enter|Run ▶

### Direction in subgraphs [​](#direction-in-subgraphs)

With the graphtype flowcharts you can use the direction statement to set the direction which the subgraph will render like in this example.

##### Code:

mermaid

```
flowchart LR
  subgraph TOP
    direction TB
    subgraph B1
        direction RL
        i1 -->f1
    end
    subgraph B2
        direction BT
        i2 -->f2
    end
  end
  A --> TOP --> B
  B1 --> B2
```

Ctrl + Enter|Run ▶

#### Limitation [​](#limitation)

If any of a subgraph's nodes are linked to the outside, subgraph direction will be ignored. Instead the subgraph will inherit the direction of the parent graph:

##### Code:

mermaid

```
flowchart LR
    subgraph subgraph1
        direction TB
        top1[top] --> bottom1[bottom]
    end
    subgraph subgraph2
        direction TB
        top2[top] --> bottom2[bottom]
    end
    %% ^ These subgraphs are identical, except for the links to them:

    %% Link *to* subgraph1: subgraph1 direction is maintained
    outside --> subgraph1
    %% Link *within* subgraph2:
    %% subgraph2 inherits the direction of the top-level graph (LR)
    outside ---> top2
```

Ctrl + Enter|Run ▶

### Collapsible subgraphs (v11.17.0+) [​](#collapsible-subgraphs-v11-17-0)

A subgraph can be collapsed into a single compact node by attaching the metadata `@{ view: collapsed }` to its id. This is useful for hiding the internals of a group while still showing how it connects to the rest of the diagram.

##### Code:

mermaid

```
flowchart TD
    Start --> one
    subgraph one [My Group]
        A --> B
        B --> C
    end
    one --> End
    one@{ view: collapsed }
```

Ctrl + Enter|Run ▶

The metadata is attached with the existing `id@{ ... }` statement syntax, where `id` is the subgraph id (use `subgraph id [Title]` to give a subgraph an explicit id). When a subgraph is collapsed:

-   Its internal nodes are hidden and it is drawn as a single node carrying the subgraph's title.
-   Edges that cross the subgraph boundary are **redirected to the collapsed node**.
-   Edges that are entirely internal to the collapsed subgraph are dropped (they would otherwise become self-loops on the collapsed node).
-   For nested subgraphs, a collapse resolves to the **outermost** collapsed ancestor, so an edge pointing at a deeply nested node lands on the outermost collapsed group.

`view: expanded` is the default and renders the subgraph normally, so omitting the metadata (or setting `view: expanded`) keeps the existing behavior.

## Markdown Strings [​](#markdown-strings)

The "Markdown Strings" feature enhances flowcharts and mind maps by offering a more versatile string type, which supports text formatting options such as bold and italics, and automatically wraps text within labels.

##### Code:

mermaid

```
---
config:
  htmlLabels: false
---
flowchart LR
subgraph "One"
  a("`The **cat**
  in the hat`") -- "edge label" --> b{{"`The **dog** in the hog`"}}
end
subgraph "`**Two**`"
  c("`The **cat**
  in the hat`") -- "`Bold **edge label**`" --> d("The dog in the hog")
end
```

Ctrl + Enter|Run ▶

Formatting:

-   For bold text, use double asterisks (`**`) before and after the text.
-   For italics, use single asterisks (`*`) before and after the text.
-   With traditional strings, you needed to add `<br>` tags for text to wrap in nodes. However, markdown strings automatically wrap text when it becomes too long and allows you to start a new line by simply using a newline character instead of a `<br>` tag.

This feature is applicable to node labels, edge labels, and subgraph labels.

The auto wrapping can be disabled by using

```
---
config:
  markdownAutoWrap: false
---
graph LR
```

## Interaction [​](#interaction)

It is possible to bind a click event to a node, the click can lead to either a javascript callback or to a link which will be opened in a new browser tab.

INFO

This functionality is disabled when using `securityLevel='strict'` and enabled when using `securityLevel='loose'`.

```
click nodeId callback
click nodeId call callback()
```

-   nodeId is the id of the node
-   callback is the name of a javascript function defined on the page displaying the graph, the function will be called with the nodeId as parameter.

Examples of tooltip usage below:

html

```
<script>
  window.callback = function () {
    alert('A callback was triggered');
  };
</script>
```

The tooltip text is surrounded in double quotes. The styles of the tooltip are set by the class `.mermaidTooltip`.

##### Code:

mermaid

```
flowchart LR
    A-->B
    B-->C
    C-->D
    click A callback "Tooltip for a callback"
    click B "https://www.github.com" "This is a tooltip for a link"
    click C call callback() "Tooltip for a callback"
    click D href "https://www.github.com" "This is a tooltip for a link"
```

Ctrl + Enter|Run ▶

> **Success** The tooltip functionality and the ability to link to urls are available from version 0.5.2.

?> Due to limitations with how Docsify handles JavaScript callback functions, an alternate working demo for the above code can be viewed at [this jsfiddle](https://jsfiddle.net/yk4h7qou/2/).

Links are opened in the same browser tab/window by default. It is possible to change this by adding a link target to the click definition (`_self`, `_blank`, `_parent` and `_top` are supported):

##### Code:

mermaid

```
flowchart LR
    A-->B
    B-->C
    C-->D
    D-->E
    click A "https://www.github.com" _blank
    click B "https://www.github.com" "Open this in a new tab" _blank
    click C href "https://www.github.com" _blank
    click D href "https://www.github.com" "Open this in a new tab" _blank
```

Ctrl + Enter|Run ▶

Beginner's tip—a full example using interactive links in a html context:

html

```
<body>
  <pre class="mermaid">
    flowchart LR
        A-->B
        B-->C
        C-->D
        click A callback "Tooltip"
        click B "https://www.github.com" "This is a link"
        click C call callback() "Tooltip"
        click D href "https://www.github.com" "This is a link"
  </pre>

  <script>
    window.callback = function () {
      alert('A callback was triggered');
    };
    const config = {
      startOnLoad: true,
      htmlLabels: true,
      flowchart: { useMaxWidth: true, curve: 'cardinal' },
      securityLevel: 'loose',
    };
    mermaid.initialize(config);
  </script>
</body>
```

### Comments [​](#comments)

Comments can be entered within a flow diagram, which will be ignored by the parser. Comments need to be on their own line, and must be prefaced with `%%` (double percent signs). Any text after the start of the comment to the next newline will be treated as a comment, including any flow syntax

##### Code:

mermaid

```
flowchart LR
%% this is a comment A -- text --> B{node}
   A -- text --> B -- text2 --> C
```

Ctrl + Enter|Run ▶

## Styling and classes [​](#styling-and-classes)

### Styling links [​](#styling-links)

It is possible to style links. For instance, you might want to style a link that is going backwards in the flow. As links have no ids in the same way as nodes, some other way of deciding what style the links should be attached to is required. Instead of ids, the order number of when the link was defined in the graph is used, or use default to apply to all links. In the example below the style defined in the linkStyle statement will belong to the fourth link in the graph:

```
linkStyle 3 stroke:#ff3,stroke-width:4px,color:red;
```

It is also possible to add style to multiple links in a single statement, by separating link numbers with commas:

```
linkStyle 1,2,7 color:blue;
```

### Styling line curves [​](#styling-line-curves)

It is possible to style the type of curve used for lines between items, if the default method does not meet your needs. Available curve styles include `basis`, `bumpX`, `bumpY`, `cardinal`, `catmullRom`, `linear`, `monotoneX`, `monotoneY`, `natural`, `step`, `stepAfter`, and `stepBefore`.

For a full list of available curves, including an explanation of custom curves, refer to the [Shapes](https://d3js.org/d3-shape/curve) documentation in the [d3-shape](https://github.com/d3/d3-shape/) project.

Line styling can be achieved in two ways:

1.  Change the curve style of all the lines
2.  Change the curve style of a particular line

#### Diagram level curve style [​](#diagram-level-curve-style)

In this example, a left-to-right graph uses the `stepBefore` curve style:

```
---
config:
  flowchart:
    curve: stepBefore
---
graph LR
```

#### Edge level curve style using Edge IDs (v11.10.0+) [​](#edge-level-curve-style-using-edge-ids-v11-10-0)

You can assign IDs to [edges](#attaching-an-id-to-edges). After assigning an ID you can modify the line style by modifying the edge's `curve` property using the following syntax:

##### Code:

mermaid

```
flowchart LR
    A e1@==> B
    A e2@--> C
    e1@{ curve: linear }
    e2@{ curve: natural }
```

Ctrl + Enter|Run ▶

info

```
Any edge curve style modified at the edge level overrides the diagram level style.
```

info

```
If the same edge is modified multiple times the last modification will be rendered.
```

### Styling a node [​](#styling-a-node)

It is possible to apply specific styles such as a thicker border or a different background color to a node.

##### Code:

mermaid

```
flowchart LR
    id1(Start)-->id2(Stop)
    style id1 fill:#f9f,stroke:#333,stroke-width:4px
    style id2 fill:#bbf,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5
```

Ctrl + Enter|Run ▶

#### Classes [​](#classes)

More convenient than defining the style every time is to define a class of styles and attach this class to the nodes that should have a different look.

A class definition looks like the example below:

```
    classDef className fill:#f9f,stroke:#333,stroke-width:4px;
```

Also, it is possible to define style to multiple classes in one statement:

```
    classDef firstClassName,secondClassName font-size:12pt;
```

Attachment of a class to a node is done as per below:

```
    class nodeId1 className;
```

It is also possible to attach a class to a list of nodes in one statement:

```
    class nodeId1,nodeId2 className;
```

A shorter form of adding a class is to attach the classname to the node using the `:::`operator as per below:

##### Code:

mermaid

```
flowchart LR
    A:::someclass --> B
    classDef someclass fill:#f96
```

Ctrl + Enter|Run ▶

This form can be used when declaring multiple links between nodes:

##### Code:

mermaid

```
flowchart LR
    A:::foo & B:::bar --> C:::foobar
    classDef foo stroke:#f00
    classDef bar stroke:#0f0
    classDef foobar stroke:#00f
```

Ctrl + Enter|Run ▶

### CSS classes [​](#css-classes)

> **Note:** Applying styles to Mermaid nodes via external CSS (e.g., `.cssClass > rect { fill: ... }`) does **not** work reliably. Mermaid's internal styles are injected with `!important` and scoped to the SVG element ID, giving them higher specificity than external CSS rules. External CSS will be silently overridden.
> 
> The recommended approach is to use the `classDef` syntax shown in the [Classes](#classes) section above, which works correctly and is the intended styling mechanism.
> 
> If external CSS is strictly required, every property must use `!important` to override Mermaid's styles — but this is not recommended.

**Working approach — use `classDef` instead:**

##### Code:

mermaid

```
flowchart LR
    A:::myStyle --> B
    classDef myStyle fill:#ff0000,stroke:#ffff00,stroke-width:4px
```

Ctrl + Enter|Run ▶

### Default class [​](#default-class)

If a class is named default it will be assigned to all classes without specific class definitions.

```
    classDef default fill:#f9f,stroke:#333,stroke-width:4px;
```

## Basic support for fontawesome [​](#basic-support-for-fontawesome)

It is possible to add icons from fontawesome.

The icons are accessed via the syntax fa:#icon class name#.

##### Code:

mermaid

```
flowchart TD
    B["fa:fa-twitter for peace"]
    B-->C[fa:fa-ban forbidden]
    B-->D(fa:fa-spinner)
    B-->E(A fa:fa-camera-retro perhaps?)
```

Ctrl + Enter|Run ▶

There are two ways to display these FontAwesome icons:

### Register FontAwesome icon packs (v11.7.0+) [​](#register-fontawesome-icon-packs-v11-7-0)

You can register your own FontAwesome icon pack following the ["Registering icon packs" instructions](https://mermaid.js.org/config/icons.html).

Supported prefixes: `fa`, `fab`, `fas`, `far`, `fal`, `fad`.

INFO

Note that it will fall back to FontAwesome CSS if FontAwesome packs are not registered.

### Register FontAwesome CSS [​](#register-fontawesome-css)

Mermaid supports Font Awesome if the CSS is included on the website. Mermaid does not have any restriction on the version of Font Awesome that can be used.

Please refer the [Official Font Awesome Documentation](https://fontawesome.com/start) on how to include it in your website.

Adding this snippet in the `<head>` would add support for Font Awesome v6.5.1

html

```
<link
  href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
  rel="stylesheet"
/>
```

### Custom icons [​](#custom-icons)

It is possible to use custom icons served from Font Awesome as long as the website imports the corresponding kit.

Note that this is currently a paid feature from Font Awesome.

For custom icons, you need to use the `fak` prefix.

**Example**

```
flowchart TD
    B[fa:fa-twitter] %% standard icon
    B-->E(fak:fa-custom-icon-name) %% custom icon
```

And trying to render it

##### Code:

mermaid

```
flowchart TD
    B["fa:fa-twitter for peace"]
    B-->C["fab:fa-truck-bold a custom icon"]
```

Ctrl + Enter|Run ▶

## Graph declarations with spaces between vertices and link and without semicolon [​](#graph-declarations-with-spaces-between-vertices-and-link-and-without-semicolon)

-   In graph declarations, the statements also can now end without a semicolon. After release 0.2.16, ending a graph statement with semicolon is just optional. So the below graph declaration is also valid along with the old declarations of the graph.
    
-   A single space is allowed between vertices and the link. However there should not be any space between a vertex and its text and a link and its text. The old syntax of graph declaration will also work and hence this new feature is optional and is introduced to improve readability.
    

Below is the new declaration of the graph edges which is also valid along with the old declaration of the graph edges.

##### Code:

mermaid

```
flowchart LR
    A[Hard edge] -->|Link text| B(Round edge)
    B --> C{Decision}
    C -->|One| D[Result one]
    C -->|Two| E[Result two]
```

Ctrl + Enter|Run ▶

## Configuration [​](#configuration)

### Renderer [​](#renderer)

The layout of the diagram is done with the layout algorithm. The default is [ELK](https://www.eclipse.org/elk/), which handles larger and more complex diagrams well and is bundled with Mermaid.

To use the classic Dagre layout instead:

```
config:
  layout: dagre
```

The `flowchart-elk` diagram type still works, but is no longer needed — it predates `layout` and selected what is now the default.

The `defaultRenderer` option of the `flowchart`, `class` and `state` config sections was removed in v12. It named a rendering engine at a time when there was more than one; all of its values had come to mean the same renderer, and its `elk` value only ever set `layout: elk` on your behalf. Use `layout` directly.

### Width [​](#width)

It is possible to adjust the width of the rendered flowchart.

This is done by defining **mermaid.flowchartConfig** or by the CLI to use a JSON file with the configuration. How to use the CLI is described in the mermaidCLI page. mermaid.flowchartConfig can be set to a JSON string with config parameters or the corresponding object.

javascript

```
mermaid.flowchartConfig = {
    width: 100%
}
```
