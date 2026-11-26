import { mount } from '@grainular/nord';
import './ui/fonts.css';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/700.css';
import './ui/frames.css';
import './styles.css';
import { initStorage } from './meta/storage';
import { loadCastPack } from './ui/castPack';
import { initMyMusic } from './ui/myMusic';
import { App } from './ui/App';
import { installDesktopKeys } from './ui/desktop';
import { installRadioKeys } from './ui/RadioUI';
import { fitStage } from './ui/stage';

// the save, the sprite pack and the player's songs are read before the first screen renders
await Promise.all([initStorage(), loadCastPack(), initMyMusic()]);
const stage = document.querySelector<HTMLElement>('#app')!;
fitStage(stage);
mount(App, { to: stage });

installDesktopKeys();
installRadioKeys();
