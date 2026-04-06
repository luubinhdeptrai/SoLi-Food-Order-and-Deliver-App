# Restaurant App Design System

This document contains the design context, color palette, typography and component guidelines extracted from the Stitch project.

## Theme Configuration
- **Color Mode:** LIGHT
- **Global Typography:**
  - Headline Font: Plus Jakarta Sans
  - Body Font: Inter
  - Label Font: Inter
- **Shape / Roundness:** Round Eight (8px / 0.5rem base)

## Color Palette

| Token | Hex | Token | Hex |
| :--- | :--- | :--- | :--- |
| **Primary** | `#0d631b` | **On Primary** | `#ffffff` |
| **Primary Container** | `#2e7d32` | **On Primary Container** | `#cbffc2` |
| **Secondary** | `#8b5000` | **On Secondary** | `#ffffff` |
| **Secondary Container** | `#ff9800` | **On Secondary Container** | `#653900` |
| **Tertiary** | `#923357` | **On Tertiary** | `#ffffff` |
| **Tertiary Container** | `#b14b6f` | **On Tertiary Container** | `#ffedf0` |
| **Error** | `#ba1a1a` | **On Error** | `#ffffff` |
| **Error Container** | `#ffdad6` | **On Error Container** | `#93000a` |
| **Background** | `#f9f9f9` | **On Background** | `#1a1c1c` |
| **Surface** | `#f9f9f9` | **On Surface** | `#1a1c1c` |
| **Surface Variant** | `#e2e2e2` | **On Surface Variant** | `#40493d` |
| **Surface Container Lowest** | `#ffffff` | **Surface Container Low** | `#f3f3f3` |
| **Surface Container** | `#eeeeee` | **Surface Container High** | `#e8e8e8` |
| **Surface Container Highest** | `#e2e2e2` | **Surface Bright** | `#f9f9f9` |
| **Surface Dim** | `#dadada` | **Surface Tint** | `#1b6d24` |
| **Outline** | `#707a6c` | **Outline Variant** | `#bfcaba` |
| **Inverse Primary** | `#88d982` | **Inverse Surface** | `#2f3131` |
| **Inverse On Surface** | `#f1f1f1` | | |

*Fixed Colors*
- Primary Fixed: `#a3f69c` (Dim: `#88d982`, On: `#002204`, On Variant: `#005312`)
- Secondary Fixed: `#ffdcbe` (Dim: `#ffb870`, On: `#2c1600`, On Variant: `#693c00`)
- Tertiary Fixed: `#ffd9e2` (Dim: `#ffb1c7`, On: `#3f001c`, On Variant: `#7f2448`)

---

# Design System Document (Stitch Design MD)

## 1. Overview & Creative North Star: "The Digital Grocer’s Atelier"

This design system moves away from the sterile, "template-grid" feel of traditional e-commerce. Our Creative North Star is **The Digital Grocer’s Atelier**: an experience that feels as fresh as a morning market but as curated as a high-end culinary magazine. 

We achieve this through **Organic Composition**. Instead of rigid rows, we use intentional white space and overlapping elements to guide the eye. By leveraging the vibrant `primary` green (#0d631b) and the appetizing `secondary` orange (#8b5000), we create a high-contrast, editorial environment where food photography isn't just an asset—it’s the architecture.

---

## 2. Colors & Surface Philosophy

### The "No-Line" Rule
To maintain a premium, modern aesthetic, **1px solid borders are prohibited** for sectioning. Structural boundaries must be defined through background color shifts.
*   **Method:** Place a `surface_container_lowest` card on a `surface_container_low` background to create a soft, natural distinction.
*   **Intent:** This eliminates visual "noise" and allows the product photography to breathe.

### Surface Hierarchy & Nesting
Treat the UI as a series of stacked, high-quality paper sheets.
*   **Base:** `surface` (#f9f9f9) for the global background.
*   **Sectioning:** Use `surface_container` (#eeeeee) for broad content areas like category backgrounds.
*   **Focus:** Use `surface_container_lowest` (#ffffff) for the most interactive elements (cards, input fields).

### The Glass & Gradient Rule
To add "soul" to the interface:
*   **CTAs:** Use a subtle linear gradient for primary buttons, transitioning from `primary` (#0d631b) to `primary_container` (#2e7d32).
*   **Overlays:** Use Glassmorphism for floating navigation bars or "Add to Cart" modals. Apply `surface` at 80% opacity with a `20px` backdrop blur.

---

## 3. Typography: Editorial Authority

We use a dual-typeface system to balance character with extreme legibility.

*   **Display & Headlines (Plus Jakarta Sans):** Used for marketing beats and category titles. The generous x-height and modern geometric curves feel "friendly yet professional."
    *   *Scale Example:* `display-md` (2.75rem) for hero promos; `headline-sm` (1.5rem) for shelf titles.
*   **Interface & Body (Inter):** Used for all functional data (prices, descriptions, weights). Inter is chosen for its superior readability at small scales on mobile screens.
    *   *Scale Example:* `body-md` (0.875rem) for product descriptions; `label-md` (0.75rem) for nutritional tags.

---

## 4. Elevation & Depth

### The Layering Principle
Depth is achieved via **Tonal Layering** rather than traditional drop shadows. 
*   **Level 0 (Floor):** `surface`
*   **Level 1 (Section):** `surface_container_low`
*   **Level 2 (Object):** `surface_container_lowest`

### Ambient Shadows
Shadows are reserved only for "floating" elements (e.g., a Bottom Sheet or a FAB). 
*   **Specification:** Blur: `24px`, Opacity: `6%`, Color: `on_surface` (#1a1c1c).
*   **The Ghost Border:** If high-contrast accessibility is required, use `outline_variant` (#bfcaba) at **15% opacity**. Never use 100% opaque borders.

---

## 5. Components

### Buttons: The Kinetic Engine
*   **Primary:** Rounded `full` (9999px). Background: `primary` gradient. Text: `on_primary` (Bold).
*   **Secondary (CTA):** Background: `secondary_container` (#ff9800). This color is reserved strictly for "Conversion" actions (e.g., Checkout).
*   **Tertiary:** Transparent background with `primary` text. Use for "View All" or "Cancel."

### Cards: The Product Stage
*   **Visual Style:** Roundedness `xl` (1.5rem). No borders. 
*   **Spacing:** Use `spacing-4` (1rem) internal padding. 
*   **Constraint:** Images must bleed to the top edge of the card to maximize the "Freshness" impact.

### Category Navigation (The "Signature" Component)
*   **Style:** Large, circular `full` roundedness icons. 
*   **Active State:** Use `primary_fixed` (#a3f69c) as a soft background glow behind the active category icon, rather than a heavy underline.

### Input Fields
*   **Style:** Rounded `md` (0.75rem). Background: `surface_container_high`. 
*   **Focus State:** Shift background to `surface_container_lowest` and add a `2px` "Ghost Border" of `primary` at 30% opacity.

---

## 6. Do’s and Don’ts

### Do:
*   **DO** use `spacing-8` or `spacing-10` between major sections to create an editorial, airy feel.
*   **DO** overlap product images slightly over card boundaries to create 3D "pop."
*   **DO** use `secondary` (#8b5000) sparingly—only for price highlights and final "Buy" buttons.

### Don’t:
*   **DON'T** use 1px dividers between list items. Use `spacing-2` of `surface_container` color to create a "gap" instead.
*   **DON'T** use pure black (#000000) for text. Always use `on_surface` (#1a1c1c) to keep the vibe soft and premium.
*   **DON'T** use sharp corners. Every element must have at least `sm` (0.25rem) roundedness to maintain the "Friendly" brand pillar.
