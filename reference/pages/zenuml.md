<!-- Source: https://mermaid.js.org/syntax/zenuml.html -->
<!-- License: MIT (Mermaid documentation) -->

# ZenUML

> Offline mirror for NerdGram1337. Upstream: [https://mermaid.js.org/syntax/zenuml.html](https://mermaid.js.org/syntax/zenuml.html)

# ZenUML [​](#zenuml)

> A Sequence diagram is an interaction diagram that shows how processes operate with one another and in what order.

Mermaid can render sequence diagrams with [ZenUML](https://zenuml.com). Note that ZenUML uses a different syntax than the original Sequence Diagram in mermaid.

##### Code:

mermaid

```
zenuml
    title Demo
    Alice->John: Hello John, how are you?
    John->Alice: Great!
    Alice->John: See you later!
```

Ctrl + Enter|Run ▶

## Syntax [​](#syntax)

### Participants [​](#participants)

The participants can be defined implicitly as in the first example on this page. The participants or actors are rendered in order of appearance in the diagram source text. Sometimes you might want to show the participants in a different order than how they appear in the first message. It is possible to specify the actor's order of appearance by doing the following:

##### Code:

mermaid

```
zenuml
    title Declare participant (optional)
    Bob
    Alice
    Alice->Bob: Hi Bob
    Bob->Alice: Hi Alice
```

Ctrl + Enter|Run ▶

### Annotators [​](#annotators)

If you specifically want to use symbols instead of just rectangles with text you can do so by using the annotator syntax to declare participants as per below.

##### Code:

mermaid

```
zenuml
    title Annotators
    @Actor Alice
    @Database Bob
    Alice->Bob: Hi Bob
    Bob->Alice: Hi Alice
```

Ctrl + Enter|Run ▶

Here are the available annotators: ![img.png](/assets/zenuml-participant-annotators.CBrJPiSM.png)

### Aliases [​](#aliases)

The participants can have a convenient identifier and a descriptive label.

##### Code:

mermaid

```
zenuml
    title Aliases
    A as Alice
    J as John
    A->J: Hello John, how are you?
    J->A: Great!
```

Ctrl + Enter|Run ▶

## Messages [​](#messages)

Messages can be one of:

1.  Sync message
2.  Async message
3.  Creation message
4.  Reply message

### Sync message [​](#sync-message)

You can think of a sync (blocking) method in a programming language.

##### Code:

mermaid

```
zenuml
    title Sync message
    A.SyncMessage
    A.SyncMessage(with, parameters) {
      B.nestedSyncMessage()
    }
```

Ctrl + Enter|Run ▶

### Async message [​](#async-message)

You can think of an async (non-blocking) method in a programming language. Fire an event and forget about it.

##### Code:

mermaid

```
zenuml
    title Async message
    Alice->Bob: How are you?
```

Ctrl + Enter|Run ▶

### Creation message [​](#creation-message)

We use `new` keyword to create an object.

##### Code:

mermaid

```
zenuml
    new A1
    new A2(with, parameters)
```

Ctrl + Enter|Run ▶

### Reply message [​](#reply-message)

There are three ways to express a reply message:

##### Code:

mermaid

```
zenuml
    // 1. assign a variable from a sync message.
    a = A.SyncMessage()

    // 1.1. optionally give the variable a type
    SomeType a = A.SyncMessage()

    // 2. use return keyword
    A.SyncMessage() {
    return result
    }

    // 3. use @return or @reply annotator on an async message
    @return
    A->B: result
```

Ctrl + Enter|Run ▶

The third way `@return` is rarely used, but it is useful when you want to return to one level up.

##### Code:

mermaid

```
zenuml
    title Reply message
    Client->A.method() {
      B.method() {
        if(condition) {
          return x1
          // return early
          @return
          A->Client: x11
        }
      }
      return x2
    }
```

Ctrl + Enter|Run ▶

## Nesting [​](#nesting)

Sync messages and Creation messages are naturally nestable with `{}`.

##### Code:

mermaid

```
zenuml
    A.method() {
      B.nested_sync_method()
      B->C: nested async message
    }
```

Ctrl + Enter|Run ▶

## Comments [​](#comments)

It is possible to add comments to a sequence diagram with `// comment` syntax. Comments will be rendered above the messages or fragments. Comments on other places are ignored. Markdown is supported.

See the example below:

##### Code:

mermaid

```
zenuml
    // a comment on a participant will not be rendered
    BookService
    // a comment on a message.
    // **Markdown** is supported.
    BookService.getBook()
```

Ctrl + Enter|Run ▶

## Loops [​](#loops)

It is possible to express loops in a ZenUML diagram. This is done by any of the following notations:

1.  while
2.  for
3.  forEach, foreach
4.  loop

zenuml

```
while(condition) {
    ...statements...
}
```

See the example below:

##### Code:

mermaid

```
zenuml
    Alice->John: Hello John, how are you?
    while(true) {
      John->Alice: Great!
    }
```

Ctrl + Enter|Run ▶

## Alt [​](#alt)

It is possible to express alternative paths in a sequence diagram. This is done by the notation

zenuml

```
if(condition1) {
    ...statements...
} else if(condition2) {
    ...statements...
} else {
    ...statements...
}
```

See the example below:

##### Code:

mermaid

```
zenuml
    Alice->Bob: Hello Bob, how are you?
    if(is_sick) {
      Bob->Alice: Not so good :(
    } else {
      Bob->Alice: Feeling fresh like a daisy
    }
```

Ctrl + Enter|Run ▶

## Opt [​](#opt)

It is possible to render an `opt` fragment. This is done by the notation

zenuml

```
opt {
  ...statements...
}
```

See the example below:

##### Code:

mermaid

```
zenuml
    Alice->Bob: Hello Bob, how are you?
    Bob->Alice: Not so good :(
    opt {
      Bob->Alice: Thanks for asking
    }
```

Ctrl + Enter|Run ▶

## Parallel [​](#parallel)

It is possible to show actions that are happening in parallel.

This is done by the notation

zenuml

```
par {
  statement1
  statement2
  statement3
}
```

See the example below:

##### Code:

mermaid

```
zenuml
    par {
        Alice->Bob: Hello guys!
        Alice->John: Hello guys!
    }
```

Ctrl + Enter|Run ▶

## Try/Catch/Finally (Break) [​](#try-catch-finally-break)

It is possible to indicate a stop of the sequence within the flow (usually used to model exceptions).

This is done by the notation

```
try {
  ...statements...
} catch {
  ...statements...
} finally {
  ...statements...
}
```

See the example below:

##### Code:

mermaid

```
zenuml
    try {
      Consumer->API: Book something
      API->BookingService: Start booking process
    } catch {
      API->Consumer: show failure
    } finally {
      API->BookingService: rollback status
    }
```

Ctrl + Enter|Run ▶

## Integrating with your library/website. [​](#integrating-with-your-library-website)

ZenUML is not bundled with mermaid. Load the `@mermaid-js/mermaid-zenuml` package alongside mermaid and register it as an external diagram:

html

```
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@12/dist/mermaid.esm.min.mjs';
  import zenuml from 'https://cdn.jsdelivr.net/npm/@mermaid-js/mermaid-zenuml@1/dist/mermaid-zenuml.esm.min.mjs';
  await mermaid.registerExternalDiagrams([zenuml]);
</script>
```
