# Design

## Overview

SkyTime uses a Clear Sky SaaS product interface: blue and sky-blue accents, cloud-like neutrals, generous spacing, and familiar controls. The app should feel calm, bright, lightweight, and professional, like opening a clean dashboard on a bright morning.

Physical scene: a consultant on a laptop in a bright home office between client calls needs to start a timer quickly, correct entries later, and export an invoice-ready summary without hunting through settings. This points to a light sky-toned interface with high legibility and quiet contrast.

## Color

Use OKLCH tokens. Do not use pure black or pure white.

- Background: `oklch(0.984 0.013 238)`
- Surface: `oklch(0.958 0.024 236)`
- Raised: `oklch(0.996 0.004 240)`
- Border: `oklch(0.882 0.042 244)`
- Text: `oklch(0.205 0.044 258)`
- Muted text: `oklch(0.505 0.037 257)`
- Primary blue: `oklch(0.54 0.205 263)`
- Primary blue strong: `oklch(0.46 0.205 263)`
- Light sky: `oklch(0.94 0.038 240)`
- Sky accent: `oklch(0.75 0.14 230)`
- Success: `oklch(0.68 0.17 145)`
- Warning: `oklch(0.76 0.16 78)`
- Error: `oklch(0.62 0.22 27)`

Accent usage is reserved for primary actions, active navigation, timer state, charts, and status indicators. Soft blue gradients are allowed on the page background, brand mark, and timer panel. Avoid purple gradients and decorative glass overuse.

## Typography

Use a system UI stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`.

- Page title: 30px, 750, line-height 1.15
- Section title: 18px, 650, line-height 1.25
- Body: 14px, 450, line-height 1.55
- Label: 12px, 650, line-height 1.2
- Data: tabular numbers where totals, timers, and durations appear

Keep prose under 75ch. Avoid display fonts and decorative type.

## Layout

Use a product shell with a light sky navigation rail on desktop and a compact top navigation on mobile. The primary timer should be visible in the first viewport and feel like the center of the dashboard. Tables and boards should use stable dimensions so labels, badges, and controls do not shift layout.

Spacing should vary by role: tight inside toolbars and tables, moderate around panels, generous only around major page groups. Cards are for actual grouped modules, not every section.

## Components

Buttons, inputs, selects, tabs, menus, switches, badges, tables, dialogs, and cards follow shadcn conventions with rounded-xl controls, rounded-2xl panels, soft blue borders, visible focus rings, hover states, disabled states, and loading states.

Use lucide icons for compact actions. Pair icons with text for primary commands and icon-only buttons only where the symbol is standard, with accessible labels.

## Motion

Use 150ms to 220ms ease-out transitions for hover, active, drag, and reveal states. Respect reduced motion. Avoid decorative page load animation.

## Product Surfaces

- Dashboard: current timer, quick project/task assignment, daily totals, recent entries, reminder state.
- Projects: project creation, status, client, budget or hourly context, totals.
- Task board: lightweight drag and drop columns for Backlog, Today, Doing, Done.
- Timesheets: date presets for week, month, financial year, annual, and custom range, with CSV and PDF export.
- Settings: reminder cadence, browser notifications, financial year start month, export identity.
