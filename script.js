const images = [
  'images/card1.jpeg', 'images/card2.jpeg', 'images/card3.jpeg',
  'images/card4.jpeg', 'images/card5.jpeg', 'images/card6.jpeg',
  'images/card7.jpeg', 'images/card8.jpeg', 'images/card9.jpeg', 'images/card10.jpeg'
];

const mainCard = document.getElementById('mainCard');
const shuffleBtn = document.getElementById('shuffleBtn');
const container = document.querySelector('.container');

let shuffleCardsElems = [];
let isAnimating = false;

mainCard.addEventListener('click', () => {
  if (isAnimating) return;
  isAnimating = true;
  mainCard.style.visibility = 'hidden';
  mainCard.style.position = 'absolute';

  splitCardAnimation()
    .then(shuffleCards)
    .then(mergeCards)
    .then(showFlash)
    .then(() => {
      const randomImg = images[Math.floor(Math.random() * images.length)];
      mainCard.style.backgroundImage = `url(${randomImg})`;
      return revealCard();
    })
    .then(() => {
      mainCard.style.visibility = 'visible';
      mainCard.style.position = 'relative';
      isAnimating = false;
    })
    .catch(() => {
      mainCard.style.visibility = 'visible';
      mainCard.style.position = 'relative';
      isAnimating = false;
    });
});


function splitCardAnimation() {
  return new Promise((resolve) => {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const containerRect = container.getBoundingClientRect();

    for (let i = 0; i < 8; i++) {
      const card = document.createElement('div');
      card.classList.add('shuffle-card');
      card.style.backgroundImage = "url('images/card-back.jpeg')";
      container.appendChild(card);
      shuffleCardsElems.push(card);

      const x = centerX - containerRect.left - 100;
      const y = centerY - containerRect.top - 150;

      gsap.set(card, {
        x: x,
        y: y,
        position: 'absolute',
        width: '200px',
        height: '300px',
        borderRadius: '10px',
        zIndex: 2
      });
    }

    resolve();
  });
}

const animationStyle = 'spiral';
function shuffleCards() {
  if (animationStyle === 'explosion') return shuffleExplosion();
  if (animationStyle === 'rotate') return shuffleRotate();
  if (animationStyle === 'spiral') return shuffleSpiral();
  /*
  if (animationStyle === 'split') return shuffleSplit();
  if (animationStyle === 'flash') return shuffleFlash();
  */
  // ...if (animationStyle === '') return shuffleCards();
}
/*
function shuffleFlash() {
  return new Promise((resolve) => {
    shuffleCardsElems.forEach((card, i) => {
      const angle = Math.random() * Math.PI * 2; // 隨機角度
      const radius = 100 + Math.random() * 100;  // 飛出去的距離
      const opacity = 0.5 + Math.random() * 0.5;

      gsap.to(card, {
        duration: 0.8,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        opacity: opacity,
        rotation: Math.random() * 720 - 360,
        ease: 'power4.out',
        delay: i * 0.05
      });
    });

    setTimeout(resolve, 1800);
  });
}

function shuffleSplit() {
  return new Promise((resolve) => {
    shuffleCardsElems.forEach((card, i) => {
      const direction = i % 2 === 0 ? -1 : 1;  // 左右分開
      const x = direction * (Math.random() * 500 + 150);  // 隨機左右偏移

      gsap.to(card, {
        duration: 0.8,
        x: x,
        rotation: Math.random() * 360,
        opacity: 0.5,
        ease: 'power4.out',
        yoyo: true,
        repeat: 1,
        delay: i * 0.05
      });
    });

    setTimeout(resolve, 2000);
  });
}
*/
function shuffleRotate() {
  return new Promise((resolve) => {
    shuffleCardsElems.forEach((card, i) => {
      const rotation = Math.random() * 360;
      const scale = 0.5 + Math.random() * 0.5;  // 隨機縮放大小

      gsap.to(card, {
        duration: 0.8,
        rotation: rotation,
        scale: scale,
        x: `+=${Math.random() * 300 - 150}`,  // 隨機左右移動
        y: `+=${Math.random() * 300 - 150}`,  // 隨機上下移動
        ease: 'power4.out',
        delay: i * 0.05
      });
    });

    setTimeout(resolve, 1200);
  });
}

function shuffleSpiral() {
  return new Promise((resolve) => {
    shuffleCardsElems.forEach((card, i) => {
      const angle = Math.random() * Math.PI * 2; // 隨機角度
      const radius = 200 + Math.random() * 100;  // 飛出去的距離
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const rot = Math.random() * 720 - 360;

      gsap.to(card, {
        duration: 0.6,
        x: `+=${x}`,
        y: `+=${y}`,
        rotation: rot,
        ease: 'power4.out',
        yoyo: true,
        repeat: 1,
        delay: i * 0.05
      });
    });

    setTimeout(resolve, 1800);
  });
}

function shuffleExplosion() {
  return new Promise((resolve) => {
    shuffleCardsElems.forEach((card, i) => {
      const x = Math.random() * 400 - 200;
      const y = Math.random() * 200 - 100;
      const rot = Math.random() * 720 - 360;

      gsap.to(card, {
        duration: 0.6,
        x: `+=${x}`,
        y: `+=${y}`,
        rotation: rot,
        ease: 'power2.inOut',
        yoyo: true,
        repeat: 1,
        delay: i * 0.05
      });
    });

    setTimeout(resolve, 2000);
  });
}

function mergeCards() {
  return new Promise((resolve) => {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const containerRect = container.getBoundingClientRect();
    const targetX = centerX - containerRect.left - 100;
    const targetY = centerY - containerRect.top - 150;

    shuffleCardsElems.forEach((card, i) => {
      gsap.to(card, {
        duration: 0.5,
        x: targetX,
        y: targetY,
        rotation: 0,
        ease: 'power2.inOut',
        delay: i * 0.05,
        onComplete: () => {
          if (i === shuffleCardsElems.length - 1) {
            setTimeout(() => {
              shuffleCardsElems.forEach(c => c.remove());
              shuffleCardsElems = [];
              resolve();
            }, 300);
          }
        }
      });
    });
  });
}


function showFlash() {
  return new Promise((resolve) => {
    const flash = document.createElement('div');
    flash.style.position = 'absolute';
    flash.style.top = 0;
    flash.style.left = 0;
    flash.style.width = '100%';
    flash.style.height = '100%';
    flash.style.backgroundColor = 'white';
    flash.style.opacity = '0';
    flash.style.zIndex = 3;
    container.appendChild(flash);

    gsap.to(flash, {
      duration: 0.2,
      opacity: 1,
      yoyo: true,
      repeat: 1,
      onComplete: () => {
        flash.remove();
        resolve();
      }
    });
  });
}

function revealCard() {
  return new Promise((resolve) => {
    // 回復占位 + 顯示
    mainCard.style.visibility = 'visible';
    mainCard.style.position = 'relative'; // 回復排版位置

    gsap.set(mainCard, { scale: 0.5, rotation: -360, opacity: 0 });

    gsap.to(mainCard, {
      duration: 1,
      scale: 1,
      rotation: 0,
      opacity: 1,
      ease: 'back.out(1.7)',
      onComplete: resolve
    });
  });
}

