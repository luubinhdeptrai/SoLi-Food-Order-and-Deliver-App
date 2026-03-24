This document outlines a scalable organization strategy for your React Native Expo project, incorporating the latest best practices from the Expo team.

### Core Directory: The `/src` Folder

The most significant organizational improvement for a growing codebase is moving application logic into a `/src` directory. This creates a clear boundary between your source code and the numerous configuration files (like `app.json`, `package.json`, and `eas.json`) that reside at the root.

- By moving your routing logic to `src/app`, you ensure that your top-level project directory remains uncluttered and readable.
- This separation makes it easier to configure build tools and linters to target only your source code, preventing them from scanning unnecessary configuration or build artifacts.
- Expo Router supports `src/app` out of the box; you simply move the folder and restart the bundler to apply the change.

### Routing vs. Implementation: The `/screens` Pattern

In Expo Router, every file in the `app` directory becomes a route. This can lead to messy routing logic if you include complex UI implementation directly in those files. A cleaner approach is to use the `app` directory solely for routing and data fetching, while delegating the UI to a `screens` folder.

- Your `src/app/study.tsx` file should act as a lightweight entry point that handles route parameters—such as a specific flashcard deck ID—and then returns a component from `src/screens/StudyScreen.tsx`.
- This pattern allows you to break down large screens into smaller, colocated sub-components (e.g., a `Flashcard` or `ProgressIndicator` component specific to that screen) without accidentally creating new routes in your navigation tree.
- It also simplifies code sharing; if you need to render the "Settings" UI in both a modal and a dedicated tab, you can simply import the same Screen component into two different route files.

### Component Architecture

For components that are truly global—such as custom buttons, input fields, or layout wrappers—maintain a central `src/components` directory.

- Use a consistent naming convention, such as kebab-case (e.g., `primary-button.tsx`), to match the latest Expo SDK recommendations.
- For complex components, create a folder named after the component with an `index.tsx` file (e.g., `src/components/card-manager/index.tsx`). This allows you to colocate smaller, private helper components in the same folder without exposing them to the rest of the app.
- Keep your styles within the component file itself. While separating styles into a `.styles.ts` file was once common, modern practice favors keeping the `StyleSheet` at the bottom of the component file to improve "locality of behavior" and make the code easier to follow.

### Logic, Hooks, and Utilities

Shared logic should be categorized into `hooks` and `utils` to keep your UI components lean and focused on presentation.

- **`src/hooks`**: Use this for stateful logic. For example, a `useFSRS` hook would be the ideal place to manage the scheduling logic for your cards, keeping that math separate from your visual components.
- **`src/utils`**: Use this for stateless helper functions, such as date formatters for "Next Review" timestamps or Japanese string parsers.
- **Testing**: Colocate your unit tests with the files they test (e.g., `format-date.test.ts` next to `format-date.ts`). This makes it immediately obvious which parts of your logic are covered by tests and simplifies file navigation.

### API and Server Logic

If you are utilizing Expo Router’s API routes, it is vital to keep server-side code isolated from your frontend logic.

- Place all API route files within `src/app/api/` (e.g., `src/app/api/sync+api.ts`). This prevents route collisions between your UI screens and your backend endpoints.
- Move shared server logic—such as database connections or authentication middleware—to a dedicated `src/server` directory.
- Since API routes run in a Node.js-like environment rather than on the device, this separation allows you to use sensitive environment variables (those not prefixed with `EXPO_PUBLIC_`) safely, as they will never be bundled into the client-side code.

### Platform-Specific Implementations

When building for both mobile and web, you may encounter components that require entirely different implementations.

- Use platform extensions to handle these differences cleanly. If you have a complex implementation for the web, create `card-view.tsx` for native and `card-view.web.tsx` for the web.
- Metro will automatically resolve the correct file based on the platform you are building for.
- This approach is far superior to using "if/else" statements or `Platform.OS` checks within your components, as it prevents "spaghetti code" and ensures that web-only libraries aren't bundled into your mobile binary.

### Recommended Structure Overview

```text
├── src/
│   ├── app/                # Routes & API (Entry points only)
│   │   ├── api/            # Server-side API routes (+api.ts)
│   │   ├── (tabs)/         # Grouped UI routes
│   │   └── _layout.tsx     # Root layout
│   ├── screens/            # Full screen implementations
│   │   ├── home/           # Home screen + its private components
│   │   └── study/          # Study screen + its private components
│   ├── components/         # Reusable global UI components
│   ├── hooks/              # Custom React hooks (e.g., useFSRS)
│   ├── utils/              # Pure helper functions & unit tests
│   ├── server/             # Shared server-side logic (DB/Auth)
│   └── constants/          # Theme, API URLs, config values
├── assets/                 # Images, fonts, and static files
├── app.json                # Expo config
└── package.json

```
