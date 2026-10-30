// 제품 목록 파일
// 제품 하나당 중괄호 한 묶음, 묶음 사이에는 쉼표
// name    화면에 보이는 제품 이름 (모델명)
// code    주소 뒤에 ?item=코드 붙이면 그 제품이 먼저 선택됨 (영문 숫자만)
// image   tiles 폴더의 제품 이미지 (타일 한 장을 위에서 정면으로 찍은 이미지)
// thumb   thumbs 폴더의 작은 미리보기 이미지 (색상 고르기 칸에 보임)
// width   타일 가로 실제 길이 mm
// height  타일 세로 실제 길이 mm
// pattern grid 바둑판 시공, half 반장 엇갈림, stagger 우드 엇갈림 랜덤 시공
// url     제품 판매 페이지 주소 (없으면 빈칸 "")

window.PRODUCTS = [
  {
    name: "색상 1",
    code: "t01",
    image: "tiles/tile-01.jpg",
    thumb: "thumbs/tile-01.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "색상 2",
    code: "t02",
    image: "tiles/tile-02.jpg",
    thumb: "thumbs/tile-02.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "색상 3",
    code: "t03",
    image: "tiles/tile-03.jpg",
    thumb: "thumbs/tile-03.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "색상 4",
    code: "t04",
    image: "tiles/tile-04.jpg",
    thumb: "thumbs/tile-04.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "색상 5",
    code: "t05",
    image: "tiles/tile-05.jpg",
    thumb: "thumbs/tile-05.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "색상 6",
    code: "t06",
    image: "tiles/tile-06.jpg",
    thumb: "thumbs/tile-06.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "색상 7",
    code: "t07",
    image: "tiles/tile-07.jpg",
    thumb: "thumbs/tile-07.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "색상 8",
    code: "t08",
    image: "tiles/tile-08.jpg",
    thumb: "thumbs/tile-08.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "색상 9",
    code: "t09",
    image: "tiles/tile-09.jpg",
    thumb: "thumbs/tile-09.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "색상 10",
    code: "t10",
    image: "tiles/tile-10.jpg",
    thumb: "thumbs/tile-10.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "색상 11",
    code: "t11",
    image: "tiles/tile-11.jpg",
    thumb: "thumbs/tile-11.jpg",
    width: 600,
    height: 600,
    pattern: "grid",
    url: ""
  },
  {
    name: "색상 12",
    code: "t12",
    image: "tiles/tile-12.jpg",
    thumb: "thumbs/tile-12.jpg",
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
