import 'leaflet';

declare module 'leaflet' {
  namespace Control {
    class Draw extends Control {
      constructor(options?: DrawOptions);
    }
  }

  namespace Draw {
    namespace Event {
      const CREATED: string;
      const EDITED: string;
      const DELETED: string;
    }
  }

  interface DrawOptions {
    draw?: Record<string, unknown>;
    edit?: Record<string, unknown>;
  }
}
