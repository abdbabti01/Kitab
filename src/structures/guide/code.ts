// C#, Java and Python examples for each structure: one using the standard library the way production code does,
// one small teaching implementation of the mechanism the Playground animates. Every example is a complete program
// whose output is checked by scripts/verify-code-examples.ts (dotnet run file.cs, java File.java, python3).
// Teaching implementations are labelled as such: they are not the source of .NET, the JDK or CPython.
import type { GuideId, Lang } from "./content.ts";

export type CodeNote = { code: string; explain: string };
export type CodeExample = {
  id: string;
  kind: "library" | "teaching";
  title: string;
  source: string;
  /** Exactly what the program prints. */
  output: string;
  notes: CodeNote[];
  complexity: string;
  caveat?: string;
  /** Which Playground steps the example corresponds to. */
  playground?: string;
};

const code = (s: TemplateStringsArray) => String.raw(s).replace(/^\n/, "").replace(/\s+$/, "");

export const examples: Record<GuideId, Record<Lang, CodeExample[]>> = {
  array: {
    csharp: [
      {
        id: "array-cs-lib", kind: "library", title: "int[] and List<int>",
        source: code`
int[] fixedSize = { 8, 3, 12, 1, 6 };
Console.WriteLine(fixedSize[2]);

var list = new List<int>(capacity: 4) { 8, 3, 12, 1 };
Console.WriteLine($"Count={list.Count} Capacity={list.Capacity}");
list.Add(7);
Console.WriteLine($"Count={list.Count} Capacity={list.Capacity}");
list.Insert(2, 5);
Console.WriteLine(string.Join(", ", list));
list.RemoveAt(0);
Console.WriteLine(string.Join(", ", list));`,
        output: "12\nCount=4 Capacity=4\nCount=5 Capacity=8\n8, 3, 5, 12, 1, 7\n3, 5, 12, 1, 7",
        notes: [
          { code: "fixedSize[2]", explain: "Index → address: one calculation, O(1). The ints are stored inside the array object." },
          { code: "list.Add(7)", explain: "The backing array is full (Count = Capacity = 4), so List<T> allocates a bigger array, copies the 4 elements and appends: the Playground's grow steps." },
          { code: "list.Insert(2, 5)", explain: "Shifts 12, 1 and 7 one slot right, then writes 5: O(n)." },
          { code: "list.RemoveAt(0)", explain: "Shifts every later element one slot left. Capacity stays 8." },
        ],
        complexity: "Index O(1) · Add amortized O(1) · Insert/RemoveAt O(n)",
        caveat: "Capacity 8 after growing from 4 is current .NET behaviour (doubling), not a documented guarantee.",
        playground: "Array · Insert at index (with capacity 4 to see growth)",
      },
      {
        id: "array-cs-teach", kind: "teaching", title: "A dynamic array, by hand",
        source: code`
var array = new DynamicArray();
foreach (var value in new[] { 8, 3, 12, 1 }) array.Add(value);
array.Insert(2, 7);
Console.WriteLine(array);

class DynamicArray
{
    private int[] _slots = new int[4]; // the block
    private int _length;               // logical length, never more than _slots.Length

    public void Add(int value) => Insert(_length, value);

    public void Insert(int index, int value)
    {
        if (index < 0 || index > _length) throw new ArgumentOutOfRangeException(nameof(index));
        if (_length == _slots.Length) Grow();
        for (int i = _length; i > index; i--) _slots[i] = _slots[i - 1]; // shift right, from the end
        _slots[index] = value;
        _length++;
    }

    private void Grow()
    {
        var bigger = new int[_slots.Length * 2];                    // allocate
        for (int i = 0; i < _length; i++) bigger[i] = _slots[i];    // copy every element
        _slots = bigger;                                            // switch; the old block is unreachable
        Console.WriteLine($"grew to {_slots.Length}");
    }

    public override string ToString() =>
        $"[{string.Join(", ", _slots[.._length])}] length={_length} capacity={_slots.Length}";
}`,
        output: "grew to 8\n[8, 3, 7, 12, 1] length=5 capacity=8",
        notes: [
          { code: "if (_length == _slots.Length) Grow();", explain: "CHECK CAPACITY: a full block cannot make room in place." },
          { code: "var bigger = new int[_slots.Length * 2];", explain: "ALLOCATE a block twice the size." },
          { code: "bigger[i] = _slots[i];", explain: "One READ + WRITE per element copied." },
          { code: "_slots = bigger;", explain: "WRITE REFERENCE: the old array is now unreachable; the garbage collector may reclaim it later." },
          { code: "_slots[i] = _slots[i - 1];", explain: "Shift right, starting from the end so no value is overwritten before it is copied." },
        ],
        complexity: "Insert O(n) · growth O(n) but rare: appends amortized O(1)",
        playground: "Array · Append to a full array",
      },
    ],
    java: [
      {
        id: "array-java-lib", kind: "library", title: "int[] and ArrayList<Integer>",
        source: code`
import java.util.ArrayList;
import java.util.List;

public class ArrayDemo {
    public static void main(String[] args) {
        int[] fixedSize = {8, 3, 12, 1, 6};
        System.out.println(fixedSize[2]);

        List<Integer> list = new ArrayList<>(4);
        list.add(8); list.add(3); list.add(12); list.add(1);
        list.add(7);
        list.add(2, 5);
        System.out.println(list);
        list.remove(0);
        System.out.println(list + " size=" + list.size());
    }
}`,
        output: "12\n[8, 3, 5, 12, 1, 7]\n[3, 5, 12, 1, 7] size=5",
        notes: [
          { code: "int[] fixedSize", explain: "Primitive ints stored inside the array object; the length can never change." },
          { code: "List<Integer> list = new ArrayList<>(4)", explain: "An Object[] of capacity 4 holding references to Integer objects (boxing), not raw ints." },
          { code: "list.add(7)", explain: "The backing array is full: ArrayList allocates a bigger one and copies (amortized O(1))." },
          { code: "list.add(2, 5)", explain: "Shifts later elements right: O(n)." },
          { code: "list.remove(0)", explain: "remove(int index) removes position 0 and shifts left. remove(Integer.valueOf(0)) would remove the value 0." },
        ],
        complexity: "get O(1) · add amortized O(1) · add(i, e)/remove(i) O(n)",
        caveat: "OpenJDK grows by about 1.5×; capacity is not visible through the List API.",
      },
      {
        id: "array-java-teach", kind: "teaching", title: "A dynamic array, by hand",
        source: code`
import java.util.Arrays;

public class DynamicArray {
    private int[] slots = new int[4]; // the block
    private int length;               // logical length

    void insert(int index, int value) {
        if (index < 0 || index > length) throw new IndexOutOfBoundsException(index);
        if (length == slots.length) grow();
        for (int i = length; i > index; i--) slots[i] = slots[i - 1]; // shift right
        slots[index] = value;
        length++;
    }

    private void grow() {
        int[] bigger = new int[slots.length * 2];        // allocate
        System.arraycopy(slots, 0, bigger, 0, length);   // copy every element
        slots = bigger;                                  // switch; the old array is unreachable
        System.out.println("grew to " + slots.length);
    }

    public static void main(String[] args) {
        DynamicArray array = new DynamicArray();
        for (int v : new int[] {8, 3, 12, 1}) array.insert(array.length, v);
        array.insert(2, 7);
        System.out.println(Arrays.toString(Arrays.copyOf(array.slots, array.length))
            + " length=" + array.length + " capacity=" + array.slots.length);
    }
}`,
        output: "grew to 8\n[8, 3, 7, 12, 1] length=5 capacity=8",
        notes: [
          { code: "if (length == slots.length) grow();", explain: "CHECK CAPACITY before making room." },
          { code: "System.arraycopy(slots, 0, bigger, 0, length)", explain: "Copies every element into the new block: O(n)." },
          { code: "slots = bigger;", explain: "The field now refers to the new array; the old one is eligible for garbage collection." },
        ],
        complexity: "Insert O(n) · appends amortized O(1)",
        playground: "Array · Append to a full array",
      },
    ],
    python: [
      {
        id: "array-py-lib", kind: "library", title: "list and array.array",
        source: code`
from array import array

values = [8, 3, 12, 1]
print(values[2])
values.append(7)
values.insert(2, 5)
print(values)
del values[0]
print(values, len(values))

packed = array("i", [8, 3, 12])
print(packed[1], packed.typecode)`,
        output: "12\n[8, 3, 5, 12, 1, 7]\n[3, 5, 12, 1, 7] 5\n3 i",
        notes: [
          { code: "values = [8, 3, 12, 1]", explain: "A list of references to int objects. In CPython: a dynamic array of pointers." },
          { code: "values.append(7)", explain: "Amortized O(1): CPython over-allocates so most appends fill a spare slot." },
          { code: "values.insert(2, 5)", explain: "Shifts the references after index 2: O(n)." },
          { code: "array(\"i\", [8, 3, 12])", explain: "array.array stores raw C ints in one buffer: compact, but only for numbers of one type." },
        ],
        complexity: "Index O(1) · append amortized O(1) · insert/del at i O(n)",
        caveat: "Python never shows capacity or addresses; growth happens inside the list.",
      },
      {
        id: "array-py-teach", kind: "teaching", title: "A dynamic array, by hand",
        source: code`
class DynamicArray:
    def __init__(self):
        self.slots = [None] * 4  # a fixed-size block (a list used as plain storage)
        self.length = 0          # logical length

    def insert(self, index, value):
        if not 0 <= index <= self.length:
            raise IndexError(index)
        if self.length == len(self.slots):
            self._grow()
        for i in range(self.length, index, -1):  # shift right, from the end
            self.slots[i] = self.slots[i - 1]
        self.slots[index] = value
        self.length += 1

    def _grow(self):
        bigger = [None] * (len(self.slots) * 2)  # allocate
        for i in range(self.length):              # copy every element
            bigger[i] = self.slots[i]
        self.slots = bigger                        # switch; the old block is unreachable
        print("grew to", len(self.slots))


array = DynamicArray()
for v in [8, 3, 12, 1]:
    array.insert(array.length, v)
array.insert(2, 7)
print(array.slots[:array.length], "length =", array.length, "capacity =", len(array.slots))`,
        output: "grew to 8\n[8, 3, 7, 12, 1] length = 5 capacity = 8",
        notes: [
          { code: "self.slots = [None] * 4", explain: "Stands in for a fixed block of slots. (A real Python list already grows by itself; this makes the mechanism visible.)" },
          { code: "self._grow()", explain: "Allocate, copy, switch: the three growth steps the Playground shows." },
        ],
        complexity: "Insert O(n) · appends amortized O(1)",
        playground: "Array · Append to a full array",
      },
    ],
  },

  "linked-list": {
    csharp: [
      {
        id: "list-cs-lib", kind: "library", title: "LinkedList<int>",
        source: code`
var list = new LinkedList<int>(new[] { 8, 3, 12, 1, 6 });
LinkedListNode<int> node = list.Find(12)!;
list.AddAfter(node, 7);
list.Remove(node);
list.AddFirst(5);
Console.WriteLine(string.Join(" -> ", list));
Console.WriteLine($"First={list.First!.Value} Last={list.Last!.Value} Count={list.Count}");`,
        output: "5 -> 8 -> 3 -> 7 -> 1 -> 6\nFirst=5 Last=6 Count=6",
        notes: [
          { code: "list.Find(12)", explain: "O(n): walks from the first node comparing values." },
          { code: "list.AddAfter(node, 7)", explain: "O(1): the node is already known, so only references change." },
          { code: "list.Remove(node)", explain: "O(1): unlinks the node (doubly linked, so its predecessor is known)." },
        ],
        complexity: "Find O(n) · AddAfter/Remove(node)/AddFirst O(1)",
      },
      {
        id: "list-cs-teach", kind: "teaching", title: "A singly linked list, by hand",
        source: code`
Node? head = new Node(8, new Node(3, new Node(12, new Node(1, null))));
head = InsertAt(head, 2, 7);
head = Delete(head, 12);
Print(head);

static Node InsertAt(Node? head, int position, int value)
{
    if (position == 0) return new Node(value, head);           // node.next = HEAD; HEAD = node
    Node previous = head!;
    for (int i = 0; i < position - 1; i++) previous = previous.Next!; // walk: O(position)
    previous.Next = new Node(value, previous.Next);            // node.next first, then previous.next
    return head!;
}

static Node? Delete(Node? head, int value)
{
    if (head is null) return null;
    if (head.Value == value) return head.Next;                 // HEAD = HEAD.next
    for (Node current = head; current.Next is not null; current = current.Next)
    {
        if (current.Next.Value == value)
        {
            current.Next = current.Next.Next;                  // the only write
            break;
        }
    }
    return head;
}

static void Print(Node? node)
{
    var parts = new List<string>();
    for (; node is not null; node = node.Next) parts.Add(node.Value.ToString());
    Console.WriteLine(string.Join(" -> ", parts) + " -> null");
}

class Node(int value, Node? next)
{
    public int Value = value;
    public Node? Next = next;
}`,
        output: "8 -> 3 -> 7 -> 1 -> null",
        notes: [
          { code: "new Node(value, previous.Next)", explain: "Allocate the node with its next reference already set: the rest of the list stays reachable." },
          { code: "previous.Next = new Node(value, previous.Next);", explain: "Redirect the predecessor: the second pointer write." },
          { code: "current.Next = current.Next.Next;", explain: "Delete is one pointer write; the skipped node becomes unreachable." },
        ],
        complexity: "Walk O(n) · relink O(1)",
        playground: "Linked list · Insert at index, Delete value",
      },
    ],
    java: [
      {
        id: "list-java-lib", kind: "library", title: "LinkedList<Integer> with a ListIterator",
        source: code`
import java.util.LinkedList;
import java.util.List;
import java.util.ListIterator;

public class LinkedListDemo {
    public static void main(String[] args) {
        LinkedList<Integer> list = new LinkedList<>(List.of(8, 3, 12, 1, 6));
        ListIterator<Integer> it = list.listIterator();
        while (it.hasNext()) {
            if (it.next() == 12) {
                it.remove();
                it.add(7);
                break;
            }
        }
        list.addFirst(5);
        System.out.println(list);
        System.out.println(list.getFirst() + " " + list.getLast() + " " + list.size());
    }
}`,
        output: "[5, 8, 3, 7, 1, 6]\n5 6 6",
        notes: [
          { code: "it.next() == 12", explain: "The walk: O(n). (Integer unboxed to int for the comparison.)" },
          { code: "it.remove();", explain: "O(1) at the cursor: unlinks the node just returned, with no second walk and no shifting. it.add(7) then links a new node there." },
        ],
        complexity: "Walk O(n) · remove/add at the iterator O(1)",
        caveat: "list.get(i) on a LinkedList is O(n); a loop calling get(i) is O(n²).",
      },
      {
        id: "list-java-teach", kind: "teaching", title: "A singly linked list, by hand",
        source: code`
public class SinglyLinked {
    static final class Node {
        int value;
        Node next;
        Node(int value, Node next) { this.value = value; this.next = next; }
    }

    static Node insertAt(Node head, int position, int value) {
        if (position == 0) return new Node(value, head);
        Node previous = head;
        for (int i = 0; i < position - 1; i++) previous = previous.next;
        previous.next = new Node(value, previous.next);
        return head;
    }

    static Node delete(Node head, int value) {
        if (head == null) return null;
        if (head.value == value) return head.next;
        for (Node current = head; current.next != null; current = current.next) {
            if (current.next.value == value) { current.next = current.next.next; break; }
        }
        return head;
    }

    public static void main(String[] args) {
        Node head = new Node(8, new Node(3, new Node(12, new Node(1, null))));
        head = insertAt(head, 2, 7);
        head = delete(head, 12);
        StringBuilder out = new StringBuilder();
        for (Node n = head; n != null; n = n.next) out.append(n.value).append(" -> ");
        System.out.println(out.append("null"));
    }
}`,
        output: "8 -> 3 -> 7 -> 1 -> null",
        notes: [
          { code: "previous.next = new Node(value, previous.next);", explain: "Two pointer writes: the new node's next, then the predecessor's next." },
          { code: "current.next = current.next.next;", explain: "Unlink: one write. The removed node is eligible for garbage collection once nothing refers to it." },
        ],
        complexity: "Walk O(n) · relink O(1)",
        playground: "Linked list · Insert at index, Delete value",
      },
    ],
    python: [
      {
        id: "list-py-lib", kind: "library", title: "collections.deque for the ends",
        source: code`
from collections import deque

items = deque([8, 3, 12, 1, 6])
items.appendleft(5)
items.append(9)
print(items.popleft(), items.pop())
print(list(items))`,
        output: "5 9\n[8, 3, 12, 1, 6]",
        notes: [
          { code: "items.appendleft(5)", explain: "O(1) at either end, unlike list.insert(0, x)." },
          { code: "items.popleft()", explain: "O(1). A deque is not a general linked list: inserting in the middle is O(n)." },
        ],
        complexity: "Both ends O(1) · middle O(n)",
        caveat: "Python has no built-in linked list with node handles; write a Node class when you need one.",
      },
      {
        id: "list-py-teach", kind: "teaching", title: "A singly linked list, by hand",
        source: code`
class Node:
    def __init__(self, value, next=None):
        self.value = value
        self.next = next


def insert_at(head, position, value):
    if position == 0:
        return Node(value, head)           # node.next = HEAD; HEAD = node
    previous = head
    for _ in range(position - 1):          # walk: O(position)
        previous = previous.next
    previous.next = Node(value, previous.next)
    return head


def delete(head, value):
    if head is None:
        return None
    if head.value == value:
        return head.next
    current = head
    while current.next is not None:
        if current.next.value == value:
            current.next = current.next.next  # the only write
            break
        current = current.next
    return head


head = Node(8, Node(3, Node(12, Node(1))))
head = insert_at(head, 2, 7)
head = delete(head, 12)
parts = []
node = head
while node is not None:
    parts.append(str(node.value))
    node = node.next
print(" -> ".join(parts) + " -> None")`,
        output: "8 -> 3 -> 7 -> 1 -> None",
        notes: [
          { code: "previous.next = Node(value, previous.next)", explain: "The new node points at its successor before the predecessor is redirected." },
          { code: "current.next = current.next.next", explain: "One reference write unlinks the node; CPython frees it once its reference count reaches zero, other runtimes later." },
        ],
        complexity: "Walk O(n) · relink O(1)",
        playground: "Linked list · Insert at index, Delete value",
      },
    ],
  },

  stack: {
    csharp: [
      {
        id: "stack-cs-lib", kind: "library", title: "Stack<string> as undo history",
        source: code`
var undo = new Stack<string>();
undo.Push("type 'a'");
undo.Push("type 'b'");
undo.Push("bold");
Console.WriteLine(undo.Peek());
Console.WriteLine(undo.Pop());
Console.WriteLine(undo.Pop());
Console.WriteLine(undo.Count);
undo.Pop();
Console.WriteLine(undo.TryPop(out var action) ? action : "nothing to undo");`,
        output: "bold\nbold\ntype 'b'\n1\nnothing to undo",
        notes: [
          { code: "undo.Push(\"type 'a'\")", explain: "Amortized O(1): writes above the top (array-backed)." },
          { code: "undo.Pop()", explain: "O(1): returns the most recent action first (LIFO)." },
          { code: "undo.TryPop(out var action)", explain: "Underflow without an exception; Pop() on an empty stack throws InvalidOperationException." },
        ],
        complexity: "Push amortized O(1) · Pop/Peek O(1)",
      },
      {
        id: "stack-cs-teach", kind: "teaching", title: "An array-backed stack with a TOP marker",
        source: code`
var stack = new ArrayStack(3);
stack.Push(8);
stack.Push(3);
stack.Push(12);
Console.WriteLine(stack.Pop());
Console.WriteLine(stack.Peek());
try { stack.Push(1); stack.Push(6); }
catch (InvalidOperationException e) { Console.WriteLine(e.Message); }

class ArrayStack(int capacity)
{
    private readonly int[] _slots = new int[capacity];
    private int _top = -1; // index of the top element; -1 when empty

    public void Push(int value)
    {
        if (_top == _slots.Length - 1) throw new InvalidOperationException("stack overflow (full)");
        _slots[++_top] = value; // move TOP up, then write
    }

    public int Pop()
    {
        if (_top < 0) throw new InvalidOperationException("stack underflow (empty)");
        return _slots[_top--];  // read, then move TOP down; the slot is not cleared
    }

    public int Peek() => _top >= 0 ? _slots[_top] : throw new InvalidOperationException("stack underflow (empty)");
}`,
        output: "12\n3\nstack overflow (full)",
        notes: [
          { code: "_slots[++_top] = value;", explain: "One marker update and one value write: the Playground's push." },
          { code: "return _slots[_top--];", explain: "Pop moves the marker; nothing else moves." },
        ],
        complexity: "Push/Pop/Peek O(1)",
        playground: "Stack · Push, Pop",
      },
    ],
    java: [
      {
        id: "stack-java-lib", kind: "library", title: "ArrayDeque<String> as a stack",
        source: code`
import java.util.ArrayDeque;
import java.util.Deque;

public class UndoDemo {
    public static void main(String[] args) {
        Deque<String> undo = new ArrayDeque<>();
        undo.push("type 'a'");
        undo.push("type 'b'");
        undo.push("bold");
        System.out.println(undo.peek());
        System.out.println(undo.pop());
        System.out.println(undo.pop());
        System.out.println(undo.size());
        undo.pop();
        String next = undo.poll();
        System.out.println(next == null ? "nothing to undo" : next);
    }
}`,
        output: "bold\nbold\ntype 'b'\n1\nnothing to undo",
        notes: [
          { code: "Deque<String> undo = new ArrayDeque<>()", explain: "The recommended stack: array-backed, not synchronized (java.util.Stack is legacy)." },
          { code: "undo.poll()", explain: "Returns null on an empty deque; pop() would throw NoSuchElementException." },
        ],
        complexity: "push amortized O(1) · pop/peek O(1)",
      },
      {
        id: "stack-java-teach", kind: "teaching", title: "Checking brackets with a stack",
        source: code`
import java.util.ArrayDeque;
import java.util.Deque;

public class Brackets {
    static boolean balanced(String text) {
        Deque<Character> open = new ArrayDeque<>();
        for (char c : text.toCharArray()) {
            if (c == '(' || c == '[' || c == '{') open.push(c);
            else if (c == ')' || c == ']' || c == '}') {
                if (open.isEmpty()) return false;              // underflow: nothing to close
                char top = open.pop();                         // the most recent opener must match
                if ("([{".indexOf(top) != ")]}".indexOf(c)) return false;
            }
        }
        return open.isEmpty();                                 // anything left was never closed
    }

    public static void main(String[] args) {
        System.out.println(balanced("f(a[i], {b})"));
        System.out.println(balanced("f(a[i)]"));
        System.out.println(balanced("(("));
    }
}`,
        output: "true\nfalse\nfalse",
        notes: [
          { code: "open.push(c)", explain: "Every opener waits on the stack." },
          { code: "char top = open.pop();", explain: "LIFO is exactly the rule for nesting: the last opened bracket must close first." },
        ],
        complexity: "O(n) time · O(n) stack in the worst case",
        playground: "Stack · Push, Pop",
      },
    ],
    python: [
      {
        id: "stack-py-lib", kind: "library", title: "list as undo history",
        source: code`
undo = []
undo.append("type 'a'")
undo.append("type 'b'")
undo.append("bold")
print(undo[-1])
print(undo.pop())
print(undo.pop())
print(len(undo))
undo.pop()
print(undo.pop() if undo else "nothing to undo")`,
        output: "bold\nbold\ntype 'b'\n1\nnothing to undo",
        notes: [
          { code: "undo.append(\"type 'a'\")", explain: "Push: amortized O(1) at the end of the list." },
          { code: "undo.pop()", explain: "Pop from the end, O(1). On an empty list it raises IndexError, hence the check." },
        ],
        complexity: "append/pop amortized O(1)",
      },
      {
        id: "stack-py-teach", kind: "teaching", title: "Checking brackets with a stack",
        source: code`
PAIRS = {")": "(", "]": "[", "}": "{"}


def balanced(text):
    stack = []
    for c in text:
        if c in "([{":
            stack.append(c)
        elif c in PAIRS:
            if not stack or stack.pop() != PAIRS[c]:  # underflow, or the wrong opener on top
                return False
    return not stack


print(balanced("f(a[i], {b})"))
print(balanced("f(a[i)]"))
print(balanced("(("))`,
        output: "True\nFalse\nFalse",
        notes: [{ code: "stack.pop() != PAIRS[c]", explain: "The most recent opener must match: LIFO." }],
        complexity: "O(n) time · O(n) stack in the worst case",
        playground: "Stack · Push, Pop",
      },
    ],
  },

  queue: {
    csharp: [
      {
        id: "queue-cs-lib", kind: "library", title: "Queue<string> of jobs",
        source: code`
var jobs = new Queue<string>();
jobs.Enqueue("email #1");
jobs.Enqueue("resize photo");
jobs.Enqueue("email #2");
Console.WriteLine(jobs.Peek());
Console.WriteLine(jobs.Dequeue());
Console.WriteLine(jobs.Dequeue());
Console.WriteLine(jobs.Count);
jobs.Dequeue();
Console.WriteLine(jobs.TryDequeue(out var job) ? job : "no work");`,
        output: "email #1\nemail #1\nresize photo\n1\nno work",
        notes: [
          { code: "jobs.Enqueue(\"email #1\")", explain: "Joins at the rear: amortized O(1) (a circular array)." },
          { code: "jobs.Dequeue()", explain: "Leaves from the front in arrival order (FIFO): O(1), nothing shifts." },
        ],
        complexity: "Enqueue amortized O(1) · Dequeue/Peek O(1)",
      },
      {
        id: "queue-cs-teach", kind: "teaching", title: "A ring buffer queue",
        source: code`
var queue = new RingQueue(4);
foreach (var job in new[] { 1, 2, 3, 4 }) queue.Enqueue(job);
Console.WriteLine(queue.Dequeue());
Console.WriteLine(queue.Dequeue());
queue.Enqueue(5);
queue.Enqueue(6);
Console.WriteLine(queue);

class RingQueue(int capacity)
{
    private readonly int[] _slots = new int[capacity];
    private int _head;  // FRONT: index of the oldest element
    private int _count;

    public void Enqueue(int value)
    {
        if (_count == _slots.Length) throw new InvalidOperationException("queue is full");
        _slots[(_head + _count) % _slots.Length] = value; // REAR wraps around to slot 0
        _count++;
    }

    public int Dequeue()
    {
        if (_count == 0) throw new InvalidOperationException("queue is empty");
        int value = _slots[_head];
        _head = (_head + 1) % _slots.Length; // move FRONT; nothing shifts
        _count--;
        return value;
    }

    public override string ToString() => $"slots=[{string.Join(", ", _slots)}] head={_head} count={_count}";
}`,
        output: "1\n2\nslots=[5, 6, 3, 4] head=2 count=4",
        notes: [
          { code: "(_head + _count) % _slots.Length", explain: "The rear position wraps: 5 and 6 reuse slots 0 and 1 freed by the dequeues." },
          { code: "_head = (_head + 1) % _slots.Length;", explain: "Dequeue moves FRONT instead of shifting every element left (which would be O(n))." },
        ],
        complexity: "Enqueue/Dequeue O(1)",
        playground: "Queue · Enqueue, Dequeue (Kitab does not draw the wrap-around)",
      },
    ],
    java: [
      {
        id: "queue-java-lib", kind: "library", title: "ArrayDeque<String> as a queue",
        source: code`
import java.util.ArrayDeque;
import java.util.Queue;

public class JobsDemo {
    public static void main(String[] args) {
        Queue<String> jobs = new ArrayDeque<>();
        jobs.offer("email #1");
        jobs.offer("resize photo");
        jobs.offer("email #2");
        System.out.println(jobs.peek());
        System.out.println(jobs.poll());
        System.out.println(jobs.poll());
        System.out.println(jobs.size());
        jobs.poll();
        String next = jobs.poll();
        System.out.println(next == null ? "no work" : next);
    }
}`,
        output: "email #1\nemail #1\nresize photo\n1\nno work",
        notes: [
          { code: "jobs.offer(\"email #1\")", explain: "Adds at the tail of a resizable circular array." },
          { code: "jobs.poll()", explain: "Removes from the head; returns null when empty (remove() would throw)." },
        ],
        complexity: "offer amortized O(1) · poll/peek O(1)",
      },
      {
        id: "queue-java-teach", kind: "teaching", title: "A ring buffer queue",
        source: code`
import java.util.Arrays;

public class RingQueue {
    private final int[] slots;
    private int head;  // FRONT
    private int count;

    RingQueue(int capacity) { slots = new int[capacity]; }

    void enqueue(int value) {
        if (count == slots.length) throw new IllegalStateException("queue is full");
        slots[(head + count) % slots.length] = value; // REAR wraps around
        count++;
    }

    int dequeue() {
        if (count == 0) throw new IllegalStateException("queue is empty");
        int value = slots[head];
        head = (head + 1) % slots.length;             // move FRONT; nothing shifts
        count--;
        return value;
    }

    public static void main(String[] args) {
        RingQueue queue = new RingQueue(4);
        for (int job : new int[] {1, 2, 3, 4}) queue.enqueue(job);
        System.out.println(queue.dequeue());
        System.out.println(queue.dequeue());
        queue.enqueue(5);
        queue.enqueue(6);
        System.out.println("slots=" + Arrays.toString(queue.slots) + " head=" + queue.head + " count=" + queue.count);
    }
}`,
        output: "1\n2\nslots=[5, 6, 3, 4] head=2 count=4",
        notes: [{ code: "% slots.length", explain: "Wrap-around: the block is reused in a circle." }],
        complexity: "enqueue/dequeue O(1)",
        playground: "Queue · Enqueue, Dequeue",
      },
    ],
    python: [
      {
        id: "queue-py-lib", kind: "library", title: "collections.deque of jobs",
        source: code`
from collections import deque

jobs = deque()
jobs.append("email #1")
jobs.append("resize photo")
jobs.append("email #2")
print(jobs[0])
print(jobs.popleft())
print(jobs.popleft())
print(len(jobs))
jobs.popleft()
print(jobs.popleft() if jobs else "no work")`,
        output: "email #1\nemail #1\nresize photo\n1\nno work",
        notes: [
          { code: "jobs.popleft()", explain: "O(1). With a list, pop(0) would shift every remaining reference: O(n)." },
        ],
        complexity: "append/popleft O(1)",
      },
      {
        id: "queue-py-teach", kind: "teaching", title: "A ring buffer queue",
        source: code`
class RingQueue:
    def __init__(self, capacity):
        self.slots = [None] * capacity
        self.head = 0   # FRONT
        self.count = 0

    def enqueue(self, value):
        if self.count == len(self.slots):
            raise OverflowError("queue is full")
        self.slots[(self.head + self.count) % len(self.slots)] = value  # REAR wraps around
        self.count += 1

    def dequeue(self):
        if self.count == 0:
            raise IndexError("queue is empty")
        value = self.slots[self.head]
        self.head = (self.head + 1) % len(self.slots)  # move FRONT; nothing shifts
        self.count -= 1
        return value


queue = RingQueue(4)
for job in [1, 2, 3, 4]:
    queue.enqueue(job)
print(queue.dequeue())
print(queue.dequeue())
queue.enqueue(5)
queue.enqueue(6)
print("slots =", queue.slots, "head =", queue.head, "count =", queue.count)`,
        output: "1\n2\nslots = [5, 6, 3, 4] head = 2 count = 4",
        notes: [{ code: "% len(self.slots)", explain: "Wrap-around reuses the slots freed by dequeues." }],
        complexity: "enqueue/dequeue O(1)",
        playground: "Queue · Enqueue, Dequeue",
      },
    ],
  },

  "hash-table": {
    csharp: [
      {
        id: "hash-cs-lib", kind: "library", title: "Dictionary<int, string> and HashSet<T>",
        source: code`
var users = new Dictionary<int, string> { [10] = "Ada", [15] = "Linus" };
users[23] = "Grace";
users[15] = "Linus T.";
Console.WriteLine(users.TryGetValue(23, out var name) ? name : "missing");
Console.WriteLine(users.ContainsKey(99));
users.Remove(10);
Console.WriteLine(users.Count);

var seen = new HashSet<Point> { new(1, 2) };
Console.WriteLine(seen.Contains(new Point(1, 2)));

record Point(int X, int Y);`,
        output: "Grace\nFalse\n2\nTrue",
        notes: [
          { code: "users[15] = \"Linus T.\"", explain: "Same key: the value is replaced; the count does not change." },
          { code: "users.TryGetValue(23, out var name)", explain: "One hash, one bucket, a few equality checks: expected O(1)." },
          { code: "record Point(int X, int Y)", explain: "A record generates Equals and GetHashCode from its fields, so two equal points find the same bucket." },
        ],
        complexity: "Add/lookup/remove expected O(1) · worst O(n)",
        caveat: "Do not rely on the order a Dictionary enumerates its keys.",
      },
      {
        id: "hash-cs-teach", kind: "teaching", title: "Separate chaining, by hand",
        source: code`
var table = new ChainedTable(7);
foreach (var key in new[] { 10, 15, 23, 8, 22 }) table.Put(key, $"user {key}");
Console.WriteLine(table.Get(22));
Console.WriteLine(table.Get(29) ?? "absent");
table.Print();

class ChainedTable(int bucketCount)
{
    private readonly List<(int Key, string Value)>[] _buckets =
        Enumerable.Range(0, bucketCount).Select(_ => new List<(int, string)>()).ToArray();

    // C#'s % can be negative for negative keys, so normalize into 0 … bucketCount − 1.
    private int BucketOf(int key) => ((key % _buckets.Length) + _buckets.Length) % _buckets.Length;

    public void Put(int key, string value)
    {
        var chain = _buckets[BucketOf(key)];
        for (int i = 0; i < chain.Count; i++)
            if (chain[i].Key == key) { chain[i] = (key, value); return; } // existing key: replace
        chain.Add((key, value));                                          // collision or empty: append
    }

    public string? Get(int key)
    {
        foreach (var (k, v) in _buckets[BucketOf(key)]) if (k == key) return v; // equality decides
        return null;
    }

    public void Print()
    {
        for (int b = 0; b < _buckets.Length; b++)
            if (_buckets[b].Count > 0) Console.WriteLine($"bucket {b}: {string.Join(" -> ", _buckets[b].Select(e => e.Key))}");
    }
}`,
        output: "user 22\nabsent\nbucket 1: 15 -> 8 -> 22\nbucket 2: 23\nbucket 3: 10",
        notes: [
          { code: "BucketOf(key)", explain: "HASH: key mod 7, the same rule as Kitab's model." },
          { code: "chain.Add((key, value))", explain: "22 mod 7 = 1 collides with 15 and 8: chaining appends it to bucket 1." },
          { code: "if (k == key) return v;", explain: "CHECK COLLISION CHAIN: the hash only picks the bucket; equality finds the key." },
        ],
        complexity: "Expected O(1) with a bounded load factor · O(chain length) per lookup",
        caveat: "Real Dictionary<TKey, TValue> spreads hash codes, uses prime bucket counts and resizes; this table never resizes.",
        playground: "Hash table · Insert key 22",
      },
    ],
    java: [
      {
        id: "hash-java-lib", kind: "library", title: "HashMap<Integer, String> and HashSet<E>",
        source: code`
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

public class UsersDemo {
    record Point(int x, int y) {}

    public static void main(String[] args) {
        Map<Integer, String> users = new HashMap<>();
        users.put(10, "Ada");
        users.put(15, "Linus");
        users.put(23, "Grace");
        String old = users.put(15, "Linus T.");
        System.out.println(old);
        System.out.println(users.getOrDefault(23, "missing"));
        System.out.println(users.containsKey(99));
        users.remove(10);
        System.out.println(users.size());

        Set<Point> seen = new HashSet<>();
        seen.add(new Point(1, 2));
        System.out.println(seen.contains(new Point(1, 2)));
    }
}`,
        output: "Linus\nGrace\nfalse\n2\ntrue",
        notes: [
          { code: "users.put(15, \"Linus T.\")", explain: "An existing key: put replaces the value and returns the old one." },
          { code: "record Point(int x, int y)", explain: "Records implement equals and hashCode from their components, as the HashSet contract requires." },
        ],
        complexity: "get/put/remove expected O(1)",
        caveat: "Integer keys are boxed; iteration order of a HashMap is unspecified.",
      },
      {
        id: "hash-java-teach", kind: "teaching", title: "Separate chaining, by hand",
        source: code`
import java.util.ArrayList;
import java.util.List;

public class ChainedTable {
    record Entry(int key, String value) {}

    private final List<List<Entry>> buckets = new ArrayList<>();

    ChainedTable(int bucketCount) { for (int i = 0; i < bucketCount; i++) buckets.add(new ArrayList<>()); }

    private int bucketOf(int key) { return Math.floorMod(key, buckets.size()); } // never negative

    void put(int key, String value) {
        List<Entry> chain = buckets.get(bucketOf(key));
        for (int i = 0; i < chain.size(); i++) {
            if (chain.get(i).key() == key) { chain.set(i, new Entry(key, value)); return; }
        }
        chain.add(new Entry(key, value));
    }

    String get(int key) {
        for (Entry e : buckets.get(bucketOf(key))) if (e.key() == key) return e.value();
        return null;
    }

    public static void main(String[] args) {
        ChainedTable table = new ChainedTable(7);
        for (int key : new int[] {10, 15, 23, 8, 22}) table.put(key, "user " + key);
        System.out.println(table.get(22));
        System.out.println(table.get(29) == null ? "absent" : "present");
        for (int b = 0; b < table.buckets.size(); b++) {
            List<Entry> chain = table.buckets.get(b);
            if (!chain.isEmpty()) System.out.println("bucket " + b + ": " + chain.stream().map(e -> String.valueOf(e.key())).toList());
        }
    }
}`,
        output: "user 22\nabsent\nbucket 1: [15, 8, 22]\nbucket 2: [23]\nbucket 3: [10]",
        notes: [
          { code: "Math.floorMod(key, buckets.size())", explain: "Java's % can be negative; floorMod keeps the bucket index valid." },
          { code: "chain.add(new Entry(key, value))", explain: "A collision appends to the bucket's chain." },
        ],
        complexity: "Expected O(1) · O(chain length) per lookup",
        caveat: "HashMap itself uses power-of-two tables, spreads hash bits and resizes at load factor 0.75.",
        playground: "Hash table · Insert key 22",
      },
    ],
    python: [
      {
        id: "hash-py-lib", kind: "library", title: "dict and set",
        source: code`
from dataclasses import dataclass

users = {10: "Ada", 15: "Linus"}
users[23] = "Grace"
users[15] = "Linus T."
print(users.get(23, "missing"))
print(99 in users)
del users[10]
print(len(users), list(users))


@dataclass(frozen=True)
class Point:
    x: int
    y: int


print(Point(1, 2) in {Point(1, 2)})`,
        output: "Grace\nFalse\n2 [15, 23]\nTrue",
        notes: [
          { code: "users[15] = \"Linus T.\"", explain: "Replaces the value; 15 keeps its original position in the order." },
          { code: "list(users)", explain: "Insertion order is guaranteed for dict (Python 3.7+), not for set." },
          { code: "@dataclass(frozen=True)", explain: "frozen=True generates __hash__ consistent with __eq__, so Points can be keys." },
        ],
        complexity: "Lookup/insert/delete expected O(1)",
        caveat: "CPython's dict uses open addressing (probing), not chaining.",
      },
      {
        id: "hash-py-teach", kind: "teaching", title: "Separate chaining, by hand",
        source: code`
class ChainedTable:
    def __init__(self, bucket_count):
        self.buckets = [[] for _ in range(bucket_count)]

    def bucket_of(self, key):
        return key % len(self.buckets)  # Python's % is never negative for a positive divisor

    def put(self, key, value):
        chain = self.buckets[self.bucket_of(key)]
        for i, (k, _) in enumerate(chain):
            if k == key:
                chain[i] = (key, value)  # existing key: replace
                return
        chain.append((key, value))       # collision or empty bucket: append

    def get(self, key):
        for k, v in self.buckets[self.bucket_of(key)]:
            if k == key:                 # equality, not the hash, decides
                return v
        return None


table = ChainedTable(7)
for key in [10, 15, 23, 8, 22]:
    table.put(key, f"user {key}")
print(table.get(22))
print(table.get(29) or "absent")
for b, chain in enumerate(table.buckets):
    if chain:
        print(f"bucket {b}:", [k for k, _ in chain])`,
        output: "user 22\nabsent\nbucket 1: [15, 8, 22]\nbucket 2: [23]\nbucket 3: [10]",
        notes: [
          { code: "key % len(self.buckets)", explain: "Kitab's rule. Real dicts call hash(key) and probe an open-addressed table." },
          { code: "if k == key", explain: "Colliding keys share a bucket; equality finds the right one." },
        ],
        complexity: "Expected O(1) · O(chain length) per lookup",
        playground: "Hash table · Insert key 22",
      },
    ],
  },

  "binary-tree": {
    csharp: [
      {
        id: "bst-cs-lib", kind: "library", title: "SortedSet<int> (a red-black tree)",
        source: code`
var prices = new SortedSet<int> { 8, 3, 12, 1, 6, 10, 14 };
Console.WriteLine(prices.Contains(6));
Console.WriteLine(string.Join(", ", prices.GetViewBetween(5, 11)));
Console.WriteLine($"{prices.Min} {prices.Max}");
prices.Remove(8);
Console.WriteLine(string.Join(", ", prices));`,
        output: "True\n6, 8, 10\n1 14\n1, 3, 6, 10, 12, 14",
        notes: [
          { code: "prices.Contains(6)", explain: "O(log n): the tree rebalances itself, so it can never become a chain." },
          { code: "prices.GetViewBetween(5, 11)", explain: "A range query: impossible to do efficiently with a hash set." },
          { code: "string.Join(\", \", prices)", explain: "In-order traversal: always sorted." },
        ],
        complexity: "Add/Remove/Contains O(log n) guaranteed",
      },
      {
        id: "bst-cs-teach", kind: "teaching", title: "An unbalanced BST: search, insert, delete",
        source: code`
Tree tree = new();
foreach (var v in new[] { 8, 3, 12, 1, 6, 10, 14 }) tree.Insert(v);
Console.WriteLine(tree.Search(6));
tree.Delete(8);
Console.WriteLine($"root={tree.Root!.Value} in-order={string.Join(",", tree.InOrder())}");

class Tree
{
    public Node? Root;

    public void Insert(int value)
    {
        if (Root is null) { Root = new Node(value); return; }
        Node at = Root;
        while (value != at.Value)
        {
            if (value < at.Value) { if (at.Left is null) { at.Left = new Node(value); return; } at = at.Left; }
            else { if (at.Right is null) { at.Right = new Node(value); return; } at = at.Right; }
        }
    }

    public string Search(int value)
    {
        var path = new List<int>();
        for (Node? at = Root; at is not null; at = value < at.Value ? at.Left : at.Right)
        {
            path.Add(at.Value);                       // one comparison per level
            if (at.Value == value) return $"found via {string.Join(" > ", path)}";
        }
        return "absent";
    }

    public void Delete(int value) => Root = Delete(Root, value);

    private static Node? Delete(Node? node, int value)
    {
        if (node is null) return null;
        if (value < node.Value) node.Left = Delete(node.Left, value);
        else if (value > node.Value) node.Right = Delete(node.Right, value);
        else if (node.Left is null) return node.Right;   // leaf or one child: link past it
        else if (node.Right is null) return node.Left;
        else
        {
            Node successor = node.Right;                 // two children: smallest value on the right
            while (successor.Left is not null) successor = successor.Left;
            node.Value = successor.Value;                // copy it into this node
            node.Right = Delete(node.Right, successor.Value);
        }
        return node;
    }

    public IEnumerable<int> InOrder() => Walk(Root);
    private static IEnumerable<int> Walk(Node? n) =>
        n is null ? [] : Walk(n.Left).Append(n.Value).Concat(Walk(n.Right));
}

class Node(int value)
{
    public int Value = value;
    public Node? Left, Right;
}`,
        output: "found via 8 > 3 > 6\nroot=10 in-order=1,3,6,10,12,14",
        notes: [
          { code: "at = value < at.Value ? at.Left : at.Right", explain: "COMPARE: each step discards a whole subtree." },
          { code: "node.Value = successor.Value;", explain: "WRITE VALUE: the node keeps its place; only its value changes." },
          { code: "node.Right = Delete(node.Right, successor.Value)", explain: "Then the successor's old node is removed (it has no left child)." },
        ],
        complexity: "O(h): O(log n) if balanced, O(n) if skewed",
        caveat: "This tree never rebalances. Insert 1, 2, 3, … and every operation becomes a linear walk.",
        playground: "Binary search tree · Delete 8",
      },
    ],
    java: [
      {
        id: "bst-java-lib", kind: "library", title: "TreeSet<Integer> (a red-black tree)",
        source: code`
import java.util.List;
import java.util.TreeSet;

public class PricesDemo {
    public static void main(String[] args) {
        TreeSet<Integer> prices = new TreeSet<>(List.of(8, 3, 12, 1, 6, 10, 14));
        System.out.println(prices.contains(6));
        System.out.println(prices.subSet(5, true, 11, true));
        System.out.println(prices.first() + " " + prices.last() + " " + prices.ceiling(7));
        prices.remove(8);
        System.out.println(prices);
    }
}`,
        output: "true\n[6, 8, 10]\n1 14 8\n[1, 3, 6, 10, 12, 14]",
        notes: [
          { code: "prices.subSet(5, true, 11, true)", explain: "All values in [5, 11]: a range view of the tree." },
          { code: "prices.ceiling(7)", explain: "The smallest value ≥ 7, found in O(log n)." },
        ],
        complexity: "add/remove/contains O(log n) guaranteed",
      },
      {
        id: "bst-java-teach", kind: "teaching", title: "An unbalanced BST: search, insert, delete",
        source: code`
import java.util.ArrayList;
import java.util.List;

public class Bst {
    static final class Node {
        int value;
        Node left, right;
        Node(int value) { this.value = value; }
    }

    Node root;

    void insert(int value) { root = insert(root, value); }
    private Node insert(Node node, int value) {
        if (node == null) return new Node(value);
        if (value < node.value) node.left = insert(node.left, value);
        else if (value > node.value) node.right = insert(node.right, value);
        return node;
    }

    String search(int value) {
        List<Integer> path = new ArrayList<>();
        for (Node at = root; at != null; at = value < at.value ? at.left : at.right) {
            path.add(at.value);
            if (at.value == value) return "found via " + path;
        }
        return "absent";
    }

    void delete(int value) { root = delete(root, value); }
    private Node delete(Node node, int value) {
        if (node == null) return null;
        if (value < node.value) node.left = delete(node.left, value);
        else if (value > node.value) node.right = delete(node.right, value);
        else if (node.left == null) return node.right;
        else if (node.right == null) return node.left;
        else {
            Node successor = node.right;
            while (successor.left != null) successor = successor.left;
            node.value = successor.value;
            node.right = delete(node.right, successor.value);
        }
        return node;
    }

    void inOrder(Node node, List<Integer> out) {
        if (node == null) return;
        inOrder(node.left, out); out.add(node.value); inOrder(node.right, out);
    }

    public static void main(String[] args) {
        Bst tree = new Bst();
        for (int v : new int[] {8, 3, 12, 1, 6, 10, 14}) tree.insert(v);
        System.out.println(tree.search(6));
        tree.delete(8);
        List<Integer> sorted = new ArrayList<>();
        tree.inOrder(tree.root, sorted);
        System.out.println("root=" + tree.root.value + " in-order=" + sorted);
    }
}`,
        output: "found via [8, 3, 6]\nroot=10 in-order=[1, 3, 6, 10, 12, 14]",
        notes: [
          { code: "node.value = successor.value;", explain: "Two children: copy the in-order successor, then delete it from the right subtree." },
        ],
        complexity: "O(h)",
        caveat: "Never rebalances; use TreeMap/TreeSet in production.",
        playground: "Binary search tree · Delete 8",
      },
    ],
    python: [
      {
        id: "bst-py-lib", kind: "library", title: "bisect on a sorted list",
        source: code`
import bisect

prices = sorted([8, 3, 12, 1, 6, 10, 14])
print(6 in prices, bisect.bisect_left(prices, 6))
bisect.insort(prices, 7)
lo = bisect.bisect_left(prices, 5)
hi = bisect.bisect_right(prices, 11)
print(prices[lo:hi])
print(prices[0], prices[-1])`,
        output: "True 2\n[6, 7, 8, 10]\n1 14",
        notes: [
          { code: "bisect.bisect_left(prices, 6)", explain: "Binary search on a sorted list: O(log n). (6 in prices is a linear scan.)" },
          { code: "bisect.insort(prices, 7)", explain: "Finds the place in O(log n) but still shifts elements: O(n). The standard library has no balanced tree." },
        ],
        complexity: "Search O(log n) · insert O(n)",
        caveat: "For large, changing sorted data use a database index or a library such as sortedcontainers.",
      },
      {
        id: "bst-py-teach", kind: "teaching", title: "An unbalanced BST: search, insert, delete",
        source: code`
class Node:
    def __init__(self, value):
        self.value, self.left, self.right = value, None, None


def insert(node, value):
    if node is None:
        return Node(value)
    if value < node.value:
        node.left = insert(node.left, value)
    elif value > node.value:
        node.right = insert(node.right, value)
    return node


def search(root, value):
    path, at = [], root
    while at is not None:
        path.append(at.value)
        if at.value == value:
            return f"found via {path}"
        at = at.left if value < at.value else at.right
    return "absent"


def delete(node, value):
    if node is None:
        return None
    if value < node.value:
        node.left = delete(node.left, value)
    elif value > node.value:
        node.right = delete(node.right, value)
    elif node.left is None:
        return node.right
    elif node.right is None:
        return node.left
    else:
        successor = node.right
        while successor.left is not None:
            successor = successor.left
        node.value = successor.value
        node.right = delete(node.right, successor.value)
    return node


def in_order(node):
    return [] if node is None else in_order(node.left) + [node.value] + in_order(node.right)


root = None
for v in [8, 3, 12, 1, 6, 10, 14]:
    root = insert(root, v)
print(search(root, 6))
root = delete(root, 8)
print("root =", root.value, "in-order =", in_order(root))`,
        output: "found via [8, 3, 6]\nroot = 10 in-order = [1, 3, 6, 10, 12, 14]",
        notes: [{ code: "node.value = successor.value", explain: "The two-children case keeps the node and replaces its value." }],
        complexity: "O(h)",
        caveat: "Recursion depth grows with the height: a skewed tree of a few thousand nodes hits the recursion limit.",
        playground: "Binary search tree · Delete 8",
      },
    ],
  },

  graph: {
    csharp: [
      {
        id: "graph-cs-lib", kind: "library", title: "Adjacency list + BFS for fewest hops",
        source: code`
var graph = new Dictionary<int, int[]>
{
    [1] = [3, 8], [3] = [1, 6], [8] = [1, 10], [6] = [3, 10], [10] = [8, 6, 12], [12] = [10], [15] = [],
};

var distance = new Dictionary<int, int> { [1] = 0 };
var queue = new Queue<int>([1]);
while (queue.Count > 0)
{
    int current = queue.Dequeue();
    foreach (int neighbor in graph[current])
    {
        if (distance.ContainsKey(neighbor)) continue; // already discovered
        distance[neighbor] = distance[current] + 1;
        queue.Enqueue(neighbor);
    }
}
Console.WriteLine($"12 is {distance[12]} edges from 1");
Console.WriteLine($"15 reachable: {distance.ContainsKey(15)}");`,
        output: "12 is 3 edges from 1\n15 reachable: False",
        notes: [
          { code: "var queue = new Queue<int>([1]);", explain: "BFS's frontier: first discovered, first explored." },
          { code: "if (distance.ContainsKey(neighbor)) continue;", explain: "The distance map doubles as the visited set, marked on discovery." },
          { code: "distance[current] + 1", explain: "Discovered from a vertex at distance d, so at distance d + 1: BFS finds fewest-edge paths." },
        ],
        complexity: "O(V + E) time · O(V) extra",
        caveat: "Edge weights would make this wrong; use Dijkstra with PriorityQueue<TElement, TPriority>.",
        playground: "Graph · Breadth-first search for 12",
      },
      {
        id: "graph-cs-teach", kind: "teaching", title: "Depth-first search with an explicit stack",
        source: code`
var graph = new Dictionary<int, int[]>
{
    [1] = [3, 8], [3] = [1, 6], [8] = [1, 10], [6] = [3, 10], [10] = [8, 6, 12], [12] = [10], [15] = [],
};

var visited = new HashSet<int>();
var order = new List<int>();
var stack = new Stack<int>([1]);
while (stack.Count > 0)
{
    int current = stack.Pop();
    if (!visited.Add(current)) continue;          // pushed twice: skip the second copy
    order.Add(current);
    foreach (int neighbor in Enumerable.Reverse(graph[current]))
        if (!visited.Contains(neighbor)) stack.Push(neighbor);
}
Console.WriteLine(string.Join(" -> ", order));`,
        output: "1 -> 3 -> 6 -> 10 -> 8 -> 12",
        notes: [
          { code: "stack.Pop()", explain: "A stack instead of a queue: the newest discovery is explored first, so the walk goes deep." },
          { code: "Enumerable.Reverse(graph[current])", explain: "Pushing in reverse puts the first neighbour on top: the same order as a recursive DFS." },
          { code: "visited.Add(current)", explain: "Marked when popped, so a vertex can be on the stack twice; the check skips the copy." },
        ],
        complexity: "O(V + E)",
        playground: "Graph · Depth-first search",
      },
    ],
    java: [
      {
        id: "graph-java-lib", kind: "library", title: "Adjacency list + BFS for fewest hops",
        source: code`
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;

public class BfsDemo {
    public static void main(String[] args) {
        Map<Integer, List<Integer>> graph = Map.of(
            1, List.of(3, 8), 3, List.of(1, 6), 8, List.of(1, 10), 6, List.of(3, 10),
            10, List.of(8, 6, 12), 12, List.of(10), 15, List.of());

        Map<Integer, Integer> distance = new HashMap<>(Map.of(1, 0));
        Queue<Integer> queue = new ArrayDeque<>(List.of(1));
        while (!queue.isEmpty()) {
            int current = queue.poll();
            for (int neighbor : graph.get(current)) {
                if (distance.containsKey(neighbor)) continue;
                distance.put(neighbor, distance.get(current) + 1);
                queue.offer(neighbor);
            }
        }
        System.out.println("12 is " + distance.get(12) + " edges from 1");
        System.out.println("15 reachable: " + distance.containsKey(15));
    }
}`,
        output: "12 is 3 edges from 1\n15 reachable: false",
        notes: [
          { code: "Queue<Integer> queue = new ArrayDeque<>(List.of(1))", explain: "The BFS frontier." },
          { code: "distance.containsKey(neighbor)", explain: "Visited check on discovery: each vertex is enqueued once." },
        ],
        complexity: "O(V + E)",
        caveat: "Map.of does not guarantee an iteration order; BFS here only iterates each vertex's own List.",
        playground: "Graph · Breadth-first search for 12",
      },
      {
        id: "graph-java-teach", kind: "teaching", title: "Recursive depth-first search",
        source: code`
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class DfsDemo {
    static final Map<Integer, List<Integer>> GRAPH = Map.of(
        1, List.of(3, 8), 3, List.of(1, 6), 8, List.of(1, 10), 6, List.of(3, 10),
        10, List.of(8, 6, 12), 12, List.of(10), 15, List.of());

    static void dfs(int vertex, Set<Integer> visited, List<Integer> order) {
        visited.add(vertex);
        order.add(vertex);
        for (int neighbor : GRAPH.get(vertex)) {
            if (!visited.contains(neighbor)) dfs(neighbor, visited, order); // one frame per level
        }
    }

    public static void main(String[] args) {
        List<Integer> order = new ArrayList<>();
        dfs(1, new HashSet<>(), order);
        System.out.println(order);
    }
}`,
        output: "[1, 3, 6, 10, 8, 12]",
        notes: [{ code: "dfs(neighbor, visited, order)", explain: "The call stack is the DFS stack: each pending call is a vertex waiting to try its next neighbour." }],
        complexity: "O(V + E) time · O(V) frames in the worst case",
        caveat: "A path thousands of vertices long would throw StackOverflowError; the explicit-stack version would not.",
        playground: "Graph · Depth-first search",
      },
    ],
    python: [
      {
        id: "graph-py-lib", kind: "library", title: "Adjacency list + BFS for fewest hops",
        source: code`
from collections import deque

graph = {1: [3, 8], 3: [1, 6], 8: [1, 10], 6: [3, 10], 10: [8, 6, 12], 12: [10], 15: []}

distance = {1: 0}
queue = deque([1])
while queue:
    current = queue.popleft()
    for neighbor in graph[current]:
        if neighbor not in distance:
            distance[neighbor] = distance[current] + 1
            queue.append(neighbor)
print(f"12 is {distance[12]} edges from 1")
print("15 reachable:", 15 in distance)`,
        output: "12 is 3 edges from 1\n15 reachable: False",
        notes: [
          { code: "queue.popleft()", explain: "deque gives O(1) dequeue; list.pop(0) would be O(n)." },
          { code: "if neighbor not in distance", explain: "The dict is the visited set: each vertex is discovered once." },
        ],
        complexity: "O(V + E)",
        playground: "Graph · Breadth-first search for 12",
      },
      {
        id: "graph-py-teach", kind: "teaching", title: "Depth-first search with an explicit stack",
        source: code`
graph = {1: [3, 8], 3: [1, 6], 8: [1, 10], 6: [3, 10], 10: [8, 6, 12], 12: [10], 15: []}

visited, order, stack = set(), [], [1]
while stack:
    current = stack.pop()
    if current in visited:          # pushed twice: skip the second copy
        continue
    visited.add(current)
    order.append(current)
    for neighbor in reversed(graph[current]):
        if neighbor not in visited:
            stack.append(neighbor)
print(" -> ".join(map(str, order)))`,
        output: "1 -> 3 -> 6 -> 10 -> 8 -> 12",
        notes: [
          { code: "stack.pop()", explain: "Newest first: the search follows one path as deep as it goes." },
          { code: "reversed(graph[current])", explain: "The first neighbour ends on top, matching recursive DFS order." },
        ],
        complexity: "O(V + E)",
        playground: "Graph · Depth-first search",
      },
    ],
  },

  recursion: {
    csharp: [
      {
        id: "rec-cs-lib", kind: "library", title: "Recursion over a folder tree",
        source: code`
var root = new Folder("project", 10,
[
    new Folder("src", 120, [new Folder("ui", 40, [])]),
    new Folder("docs", 30, []),
]);
Console.WriteLine(TotalSize(root));
Console.WriteLine(Depth(root));

static int TotalSize(Folder folder) =>
    folder.OwnBytes + folder.Children.Sum(TotalSize);   // base case: no children → just OwnBytes

static int Depth(Folder folder) =>
    1 + (folder.Children.Count == 0 ? 0 : folder.Children.Max(Depth));

record Folder(string Name, int OwnBytes, List<Folder> Children);`,
        output: "200\n3",
        notes: [
          { code: "folder.Children.Sum(TotalSize)", explain: "Each sub-folder is the same problem, smaller: one call (one frame) per folder on the current path." },
          { code: "Children.Count == 0", explain: "A folder with no sub-folders is the base case: no further calls." },
        ],
        complexity: "O(n) folders · O(depth) frames",
        caveat: "Very deep trees can overflow the stack; StackOverflowException cannot be caught in .NET.",
      },
      {
        id: "rec-cs-teach", kind: "teaching", title: "factorial: frames pushed, then unwound",
        source: code`
Console.WriteLine($"result {Factorial(3, 0)}");
Console.WriteLine($"loop   {FactorialLoop(3)}");

static int Factorial(int n, int depth)
{
    string indent = new(' ', depth * 2);
    Console.WriteLine($"{indent}call factorial({n})");      // a new frame with its own n
    if (n <= 1)
    {
        Console.WriteLine($"{indent}return 1");               // base case: no further call
        return 1;
    }
    int result = n * Factorial(n - 1, depth + 1);             // this frame waits here
    Console.WriteLine($"{indent}return {result}");
    return result;
}

static int FactorialLoop(int n)
{
    int result = 1;
    for (int i = 2; i <= n; i++) result *= i;                 // same work, one frame
    return result;
}`,
        output: "call factorial(3)\n  call factorial(2)\n    call factorial(1)\n    return 1\n  return 2\nreturn 6\nresult 6\nloop   6",
        notes: [
          { code: "n * Factorial(n - 1, depth + 1)", explain: "The caller is suspended until the call returns: the Playground's 'waiting' frame." },
          { code: "if (n <= 1)", explain: "Base case. Remove it and the calls never stop until the stack overflows." },
        ],
        complexity: "O(n) time · O(n) frames (the loop: O(1))",
        playground: "Recursion · factorial(3)",
      },
    ],
    java: [
      {
        id: "rec-java-lib", kind: "library", title: "Recursion over a folder tree",
        source: code`
import java.util.List;

public class Folders {
    record Folder(String name, int ownBytes, List<Folder> children) {}

    static int totalSize(Folder folder) {
        int total = folder.ownBytes();
        for (Folder child : folder.children()) total += totalSize(child); // one frame per level
        return total;
    }

    public static void main(String[] args) {
        Folder root = new Folder("project", 10, List.of(
            new Folder("src", 120, List.of(new Folder("ui", 40, List.of()))),
            new Folder("docs", 30, List.of())));
        System.out.println(totalSize(root));
    }
}`,
        output: "200",
        notes: [{ code: "total += totalSize(child)", explain: "The same question for each sub-folder; the empty child list is the base case." }],
        complexity: "O(n) folders · O(depth) frames",
        caveat: "Too deep a recursion throws StackOverflowError; the JVM does not eliminate tail calls.",
      },
      {
        id: "rec-java-teach", kind: "teaching", title: "factorial: frames pushed, then unwound",
        source: code`
public class Factorial {
    static int factorial(int n, int depth) {
        String indent = "  ".repeat(depth);
        System.out.println(indent + "call factorial(" + n + ")");
        if (n <= 1) {
            System.out.println(indent + "return 1");
            return 1;
        }
        int result = n * factorial(n - 1, depth + 1);
        System.out.println(indent + "return " + result);
        return result;
    }

    public static void main(String[] args) {
        System.out.println("result " + factorial(3, 0));
    }
}`,
        output: "call factorial(3)\n  call factorial(2)\n    call factorial(1)\n    return 1\n  return 2\nreturn 6\nresult 6",
        notes: [{ code: "n * factorial(n - 1, depth + 1)", explain: "Each frame keeps its own n while it waits for the call below it." }],
        complexity: "O(n) time · O(n) frames",
        playground: "Recursion · factorial(3)",
      },
    ],
    python: [
      {
        id: "rec-py-lib", kind: "library", title: "Recursion over a folder tree",
        source: code`
from dataclasses import dataclass, field


@dataclass
class Folder:
    name: str
    own_bytes: int
    children: list = field(default_factory=list)


def total_size(folder):
    return folder.own_bytes + sum(total_size(child) for child in folder.children)


root = Folder("project", 10, [Folder("src", 120, [Folder("ui", 40)]), Folder("docs", 30)])
print(total_size(root))`,
        output: "200",
        notes: [{ code: "sum(total_size(child) for child in folder.children)", explain: "An empty children list sums to 0: the base case needs no special code." }],
        complexity: "O(n) folders · O(depth) frames",
        caveat: "Deeper than sys.getrecursionlimit() (1000 by default) raises RecursionError.",
      },
      {
        id: "rec-py-teach", kind: "teaching", title: "factorial: frames pushed, then unwound",
        source: code`
def factorial(n, depth=0):
    indent = "  " * depth
    print(f"{indent}call factorial({n})")
    if n <= 1:
        print(f"{indent}return 1")
        return 1
    result = n * factorial(n - 1, depth + 1)
    print(f"{indent}return {result}")
    return result


print("result", factorial(3))`,
        output: "call factorial(3)\n  call factorial(2)\n    call factorial(1)\n    return 1\n  return 2\nreturn 6\nresult 6",
        notes: [{ code: "result = n * factorial(n - 1, depth + 1)", explain: "This frame waits; CPython keeps one frame per pending call (no tail-call elimination)." }],
        complexity: "O(n) time · O(n) frames",
        playground: "Recursion · factorial(3)",
      },
    ],
  },
};

/** Every example, flattened, with where it belongs. */
export function allExamples() {
  return Object.entries(examples).flatMap(([guide, byLang]) =>
    Object.entries(byLang).flatMap(([lang, list]) => list.map((example) => ({ guide: guide as GuideId, lang: lang as Lang, example }))),
  );
}
