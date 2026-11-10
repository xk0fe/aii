// The app's first import (main.js): an older install's folder is moved before core/home.js, which everything else
// reads it through, looks for it. Nothing but main.js imports this.
import { moveHome } from './migrate.js'

moveHome()
