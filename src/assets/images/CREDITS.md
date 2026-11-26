# Image Assets & Credits

AI-generated background images were intentionally removed from Smart Cart so portals either display clean, WCAG AA colour gradients or real user-supplied WebP photographs placed in `src/assets/images/photos/`.

## Portal Photograph Slots (`src/assets/images/photos/`)

Place your own licensed photographs (converted to `.webp` at `800w` mobile and `1600w` desktop widths) into `src/assets/images/photos/` using these filenames:

| Portal | Variant | Expected Filenames | Status | Source / Licence |
| :--- | :--- | :--- | :--- | :--- |
| Shopper (`/login`, home) | Backdrop | `shopper-bg-800.webp`, `shopper-bg-1600.webp` | _Optional / fallback to plain gradient_ | User-supplied |
| Shopper (banner) | Banner | `shopper-banner-800.webp`, `shopper-banner-1600.webp` | _Optional / fallback to plain gradient_ | User-supplied |
| Store Owner & Staff (`/store/login`, dashboards) | Backdrop | `supermarket-bg-800.webp`, `supermarket-bg-1600.webp` | _Optional / fallback to plain gradient_ | User-supplied |
| Store Owner & Staff (banners) | Banner | `supermarket-banner-800.webp`, `supermarket-banner-1600.webp` | _Optional / fallback to plain gradient_ | User-supplied |
| Admin (`/admin/login`, admin banner) | Backdrop | `admin-bg-800.webp`, `admin-bg-1600.webp` | _Optional / fallback to plain gradient_ | User-supplied |
| Admin (banner) | Banner | `admin-banner-800.webp`, `admin-banner-1600.webp` | _Optional / fallback to plain gradient_ | User-supplied |

## Merchandise Reward Placeholders

Simple vector product placeholders for the Smart Cart rewards catalogue (replaceable with studio photography later):

| File | Usage | Source | Licence |
| :--- | :--- | :--- | :--- |
| `public/images/rewards/smartcart-tshirt.svg` | Smart Cart T-shirt reward placeholder | Proprietary UI icon | Proprietary to this app |
| `public/images/rewards/smartcart-hoodie.svg` | Smart Cart Hoodie reward placeholder | Proprietary UI icon | Proprietary to this app |
| `public/images/rewards/smartcart-cap.svg` | Smart Cart Cap reward placeholder | Proprietary UI icon | Proprietary to this app |
