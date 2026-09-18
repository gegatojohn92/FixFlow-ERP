# Mobile UI Refactor Spec: Pastel Neomorphic Card Deck

Use this prompt and design specification with your AI coding agent (Cursor, Claude Code, Windsurf, Copilot, etc.) to replace your existing UI.

---

## 🤖 Prompt for your AI Coding Agent

Copy and paste the prompt below directly into your AI coding tool:

```text
I am refactoring the UI of my mobile view to match a new design system. Please analyze our current screen/component structure and update it using the following design specifications:

1. Color Palette:
   - Screen Background: Warm Butter Yellow (#F6D869 / #F9DE74)
   - Front Card / Hero Deck: Sage Olive Green (#98AB6A / #A1B574) with translucent or light-green row pills (#EFF4DC / rgba(255,255,255,0.25))
   - Middle Stack Card: Pastel Powder Blue / Lilac (#ABC4E8)
   - Rear Stack Card: Pastel Candy Pink (#F4A7D0)
   - Bottom Bar: Deep Matte Black (#111111) with white icons (#FFFFFF)
   - Accent / Notification Badges: Vibrant Magenta-Pink (#E84B85)
   - Primary Text: Dark Charcoal (#181818)

2. Typography & Hierarchy:
   - Font Family: Geometric Sans (Outfit, Plus Jakarta Sans, or Poppins)
   - Hero Header: Bold, organic display type ("Discover, / Create, Enjoy") with lighter subtext ("Work hard, play hard")
   - Text Transform: Natural Title Case and rounded glyph shapes

3. Key Components to Implement:
   - Header Bar: Pill/Circle back button (left), centered title ("Home"), search icon & notification bell with magenta dot (right).
   - Horizontal Filter/Category Strip: Circular icon buttons (white background), solid black pill for active filter (with white text & icon), and secondary action pill ("+ Create a...").
   - Stacked Card Deck: Layered cards with subtle top tabs showing category icons (e.g., star icon on pink card, face/glasses icon on blue card). The top card has rounded corners (`rounded-3xl` or `border-radius: 32px`) containing interactive menu rows.
   - Menu Rows inside Active Card: Pill-shaped items with icon badges, label, and right chevron.
   - Floating Action Button / Cutout Notch: A circular close (`✕`) button resting at the bottom-center of the front card.
   - Bottom Navigation Bar: Floating curved black pill dock with minimal outline icons and an active indicator dot beneath the active tab.

Please adapt our existing state, routes, and data handlers to fit this layout without breaking our business logic.
```

---

## 🎨 Design Tokens Reference

| Element | Value / CSS | Tailwind Equivalent | Notes |
| :--- | :--- | :--- | :--- |
| **Main Background** | `#F6D869` | `bg-[#F6D869]` | Cheerful warm buttercup yellow |
| **Foreground Text** | `#181818` | `text-[#181818]` | Softened black for clean contrast |
| **Front Card** | `#98AB6A` | `bg-[#98AB6A]` | Olive/Sage green with soft shadow |
| **Secondary Stack Card** | `#ABC4E8` | `bg-[#ABC4E8]` | Soft periwinkle/baby blue |
| **Tertiary Stack Card** | `#F4A7D0` | `bg-[#F4A7D0]` | Soft bubblegum pink |
| **Active List Item** | `#F1F5E8` | `bg-[#F1F5E8]` | Off-white pill row with dark text |
| **Inactive List Item**| `rgba(0,0,0,0.06)` | `bg-black/5` or `bg-white/20` | Subtle contrast inside card |
| **Bottom Dock** | `#111111` | `bg-[#111111]` | Floats above screen bottom |
| **Pink Accent Dot** | `#E84B85` | `bg-[#E84B85]` | Used for notification alerts |
| **Border Radius (Cards)**| `28px` - `36px` | `rounded-[32px]` | Exaggerated organic rounded shapes |
| **Border Radius (Pills)**| `9999px` | `rounded-full` | Fully rounded buttons & rows |

---

## 📐 Structural Layout Breakdown

```text
┌──────────────────────────────────────────────┐
│ [ < ]                Home          [ 🔍 ] [ 🔔* ] │  <- Top App Bar
│                                              │
│ Discover,                                    │  <- Hero Title
│ Create, Enjoy                                │
│ Work hard, play hard                         │  <- Subtitle
│                                              │
│ [ 📄 ] [ ⚙️* ] ( 💬 Comments ) [ + Create a... ]│  <- Filter / Quick Actions
│                                              │
│            ┌────────────────────┐ [ ⭐ ]     │  <- Stack Card 3 (Pink)
│       ┌────┴────────────────────┴──────┐ [ 👓 ]│  <- Stack Card 2 (Blue)
│ ┌─────┴────────────────────────────────┴─────┐│  <- Stack Card 1 (Sage)
│ │ Events with Friends            •••    👥   ││
│ │ ┌────────────────────────────────────────┐ ││
│ │ │ 📅  Check dates                      > │ ││
│ │ └────────────────────────────────────────┘ ││
│ │ ┌────────────────────────────────────────┐ ││
│ │ │ ⏱️* Coming soon                      > │ ││
│ │ └────────────────────────────────────────┘ ││
│ │ ┌────────────────────────────────────────┐ ││
│ │ │ 🚀  Most shared                      > │ ││
│ │ └────────────────────────────────────────┘ ││
│ └───────────────────( ✕ )────────────────────┘│  <- Center Dismiss Button
│                                              │
│       ┌──────────────────────────────┐       │
│       │   🏠•     🔄     🔖     👤   │       │  <- Floating Black Nav Dock
│       └──────────────────────────────┘       │
└──────────────────────────────────────────────┘
```