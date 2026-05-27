export interface QueueEvent {
  id: string;
  type: "user_message" | "scheduled" | "emission";
  priority: "high" | "normal";
  payload: unknown;
  createdAt: Date;
}

export class EventQueue {
  private pendingEvents: QueueEvent[] = [];
  private pendingResolver: (() => void) | null = null;

  push(event: QueueEvent): void {
    this.pendingEvents.push(event);
    this.sortByPriority();

    if (this.pendingResolver) {
      this.pendingResolver();
      this.pendingResolver = null;
    }
  }

  shift(): QueueEvent | undefined {
    return this.pendingEvents.shift();
  }

  drainHighPriority(): QueueEvent[] {
    const highPriorityEvents: QueueEvent[] = [];

    this.pendingEvents = this.pendingEvents.filter((event) => {
      if (event.priority === "high") {
        highPriorityEvents.push(event);
        return false;
      }
      return true;
    });

    return highPriorityEvents;
  }

  get length(): number {
    return this.pendingEvents.length;
  }

  waitForEvent(): Promise<void> {
    if (this.pendingEvents.length > 0) return Promise.resolve();

    return new Promise((resolve) => {
      this.pendingResolver = resolve;
    });
  }

  private sortByPriority(): void {
    this.pendingEvents.sort((eventA, eventB) => {
      if (eventA.priority !== eventB.priority) {
        return eventA.priority === "high" ? -1 : 1;
      }
      return eventA.createdAt.getTime() - eventB.createdAt.getTime();
    });
  }
}
