const images = [
  'images/1.png', 'images/2.png', 'images/3.png',
  'images/4.png', 'images/5.png', 'images/6.png',
  'images/7.png', 'images/8.png', 'images/9.png', 'images/10.png'
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
    .then(() => {
      return new Promise(resolve => {
        const onClick = () => {
          document.removeEventListener('click', onClick);
          resolve();
        };
        document.addEventListener('click', onClick, { once: true });
      });
    })
    .then(() => {
      return coverCard();
    })
    .catch(() => {
      mainCard.style.visibility = 'visible';
      mainCard.style.position = 'relative';
      isAnimating = false;
    });
});

function coverCard() {
  return new Promise((resolve) => {
    gsap.to(mainCard, {
      duration: 0.5,
      rotationY: 90,
      ease: 'power2.in',
      onComplete: () => {
        mainCard.style.backgroundImage = "url('images/card-back.png')";
        gsap.to(mainCard, {
          duration: 0.5,
          rotationY: 0,
          ease: 'power2.out',
          onComplete: resolve
        });
      }
    });
  });
}

function splitCardAnimation() {
  return new Promise((resolve) => {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const containerRect = container.getBoundingClientRect();

    for (let i = 0; i < 8; i++) {
      const card = document.createElement('div');
      card.classList.add('shuffle-card');
      card.style.backgroundImage = "url('images/card-back.png')";
      container.appendChild(card);
      shuffleCardsElems.push(card);

      const x = centerX - containerRect.left - 100;
      const y = centerY - containerRect.top - 150;

      gsap.set(card, {
        x: x,
        y: y,
        position: 'absolute',
        width: '200px',
        height: '280px',
        borderRadius: '10px',
        zIndex: 2
      });
    }

    resolve();
  });
}

const animationStyle = 'spiral';
function shuffleCards() {
  if (animationStyle === 'spiral') return shuffleSpiral();
}
function shuffleSpiral() {
  return new Promise((resolve) => {
    shuffleCardsElems.forEach((card, i) => {
      const angle = Math.random() * Math.PI * 2;
      const radius = 200 + Math.random() * 100;
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

function updateRadiateSize() {
  const radiate = document.querySelector('.radiate');
  if (radiate) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const size = Math.max(vw, vh) * 1.5;
    radiate.style.width = `${size}px`;
    radiate.style.height = `${size}px`;
  }
}

function mergeCards() {
  return new Promise((resolve) => {
    const blocker = document.querySelector('.blocker');
    if (blocker) blocker.classList.add('active');

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
              const radiate = document.querySelector('.radiate');
              updateRadiateSize();
              window.addEventListener('resize', updateRadiateSize);
              if (radiate) {
                radiate.style.display = 'block';
                radiate.style.opacity = '1';
                radiate.style.pointerEvents = 'auto';
                
                const onClickToDismiss = () => {
                  radiate.style.opacity = '0';

                  setTimeout(() => {
                    radiate.style.display = 'none';
                    radiate.style.pointerEvents = 'none';
                    radiate.style.opacity = '1';
                    if (blocker) blocker.classList.remove('active');
                    document.removeEventListener('click', onClickToDismiss);
                    resolve();
                  }, 1000);
                };
                setTimeout(() => {
                  document.addEventListener('click', onClickToDismiss, { once: true });
                }, 0);
              } else {
                if (blocker) blocker.classList.remove('active');
                resolve();
              }

            }, 10);
          }
        }
      });
    });
  });
}

function showFlash() {
  return new Promise((resolve) => {
    const flash = document.createElement('div');
    flash.style.position = 'fixed';
    flash.style.width = '200px';
    flash.style.height = '280px';
    flash.style.top = '50%';
    flash.style.left = '50%';
    flash.style.transform = 'translate(-50%, -50%)';
    flash.style.backgroundColor = 'rgba(250, 236, 106, 0.85)';
    flash.style.opacity = '0';
    flash.style.zIndex = 9999;
    flash.style.borderRadius = '10px';
    flash.style.boxShadow = '0 0 20px rgb(255, 253, 151)';

    document.body.appendChild(flash);

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
    mainCard.style.visibility = 'visible';
    mainCard.style.position = 'relative';
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

