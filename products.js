// 제품 목록 파일
// 제품 하나당 중괄호 한 묶음, 묶음 사이에는 쉼표
// name    화면에 보이는 제품 이름 (모델명)
// code    주소 뒤에 ?item=코드 붙이면 그 제품이 먼저 선택됨 (영문 숫자만)
// image   tiles 폴더의 제품 이미지 (타일 한 장을 위에서 정면으로 찍은 이미지, tiles4 가 없을 때 씀)
// tiles4  tiles4 폴더의 무늬 4장 세트 (서로 다른 무늬 4장을 2×2로 줄눈 없이 붙인 이미지, 바닥에 4장을 무작위로 섞어 깖)
// thumb   thumbs 폴더의 작은 미리보기 이미지 (색상 고르기 칸에 보임)
// width   타일 가로 실제 길이 mm
// height  타일 세로 실제 길이 mm
// pattern grid 바둑판 시공, half 반장 엇갈림, stagger 우드 엇갈림 랜덤 시공
// url     제품 판매 페이지 주소 (없으면 빈칸 "")

window.PRODUCTS = [
  {
    name: "NPT16252",
    code: "NPT16252",
    image: "tiles/tile-01.jpg",
    tiles4: "tiles4/NPT16252.jpg",
    thumb: "thumbs/NPT16252.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "NPT16272",
    code: "NPT16272",
    image: "tiles/tile-02.jpg",
    tiles4: "tiles4/NPT16272.jpg",
    thumb: "thumbs/NPT16272.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "NPT16282",
    code: "NPT16282",
    image: "tiles/tile-03.jpg",
    tiles4: "tiles4/NPT16282.jpg",
    thumb: "thumbs/NPT16282.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "NPT16302",
    code: "NPT16302",
    image: "tiles/tile-04.jpg",
    tiles4: "tiles4/NPT16302.jpg",
    thumb: "thumbs/NPT16302.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "NPT16312",
    code: "NPT16312",
    image: "tiles/tile-05.jpg",
    tiles4: "tiles4/NPT16312.jpg",
    thumb: "thumbs/NPT16312.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "NPT16320",
    code: "NPT16320",
    image: "tiles/tile-06.jpg",
    tiles4: "tiles4/NPT16320.jpg",
    thumb: "thumbs/NPT16320.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "NPT16332",
    code: "NPT16332",
    image: "tiles/tile-07.jpg",
    tiles4: "tiles4/NPT16332.jpg",
    thumb: "thumbs/NPT16332.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "NPT16342",
    code: "NPT16342",
    image: "tiles/tile-08.jpg",
    tiles4: "tiles4/NPT16342.jpg",
    thumb: "thumbs/NPT16342.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "NPT16352",
    code: "NPT16352",
    image: "tiles/tile-09.jpg",
    tiles4: "tiles4/NPT16352.jpg",
    thumb: "thumbs/NPT16352.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "NPT16362",
    code: "NPT16362",
    image: "tiles/tile-10.jpg",
    tiles4: "tiles4/NPT16362.jpg",
    thumb: "thumbs/NPT16362.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "NPT16372",
    code: "NPT16372",
    image: "tiles/tile-11.jpg",
    tiles4: "tiles4/NPT16372.jpg",
    thumb: "thumbs/NPT16372.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "NPT16382",
    code: "NPT16382",
    image: "tiles/tile-12.jpg",
    tiles4: "tiles4/NPT16382.jpg",
    thumb: "thumbs/NPT16382.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  }
];

// 상단 가게 이름과 저장 사진 귀퉁이에 들어가는 문구
window.SHOP = {
  name: "새로고침",
  tagline: "데코타일 미리보기"
};
