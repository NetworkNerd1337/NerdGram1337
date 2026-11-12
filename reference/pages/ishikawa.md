<!-- Source: https://mermaid.js.org/syntax/ishikawa.html -->
<!-- License: MIT (Mermaid documentation) -->

# Ishikawa

> Offline mirror for NerdGram1337. Upstream: [https://mermaid.js.org/syntax/ishikawa.html](https://mermaid.js.org/syntax/ishikawa.html)

# Ishikawa diagram (v11.12.3+) [​](#ishikawa-diagram-v11-12-3)

Ishikawa diagrams are used to represent causes of a specific event (or a problem). They are also known as fishbone diagrams, herringbone diagrams or cause-and-effect diagrams. The diagram resembles a fish skeleton, with the main problem at the head and the causes branching off from the spine.

## Syntax [​](#syntax)

##### Code:

mermaid

```
ishikawa-beta
    Blurry Photo
    Process
        Out of focus
        Shutter speed too slow
        Protective film not removed
        Beautification filter applied
    User
        Shaky hands
    Equipment
        LENS
            Inappropriate lens
            Damaged lens
            Dirty lens
        SENSOR
            Damaged sensor
            Dirty sensor
    Environment
        Subject moved too quickly
        Too dark
```

Ctrl + Enter|Run ▶

-   The first line is the event (problem) of the diagram.
-   Subsequent lines are causes of the event.
-   "Fishbone" structure is indicated by indentation.
