// 제품 목록 파일
// 제품 하나당 중괄호 한 묶음, 묶음 사이에는 쉼표
// name    화면에 보이는 제품 이름
// code    주소 뒤에 ?item=코드 붙이면 그 제품이 먼저 선택됨 (영문 숫자만)
// image   tiles 폴더에 넣은 제품 이미지 파일 이름 (타일 한 장을 위에서 정면으로 찍은 이미지)
// width   이미지 가로 방향 실제 길이 mm (우드는 긴 쪽)
// height  이미지 세로 방향 실제 길이 mm
// pattern stagger 우드 엇갈림 랜덤 시공, half 반장 엇갈림, grid 바둑판 타일 시공
// url     제품 판매 페이지 주소 (없으면 빈칸 "")

window.PRODUCTS = [
  {
    name: "샘플 내추럴 오크",
    code: "oak",
    image: "tiles/sample-oak.jpg",
    width: 920,
    height: 152,
    pattern: "stagger",
    url: ""
  },
  {
    name: "샘플 화이트 애쉬",
    code: "ash",
    image: "tiles/sample-ash.jpg",
    width: 920,
    height: 152,
    pattern: "stagger",
    url: ""
  },
  {
    name: "샘플 다크 월넛",
    code: "walnut",
    image: "tiles/sample-walnut.jpg",
    width: 920,
    height: 152,
    pattern: "half",
    url: ""
  },
  {
    name: "샘플 그레이 스톤",
    code: "stone",
    image: "tiles/sample-stone.jpg",
    width: 457,
    height: 457,
    pattern: "grid",
    url: ""
  }
];

// 상단 가게 이름과 저장 사진 귀퉁이에 들어가는 문구
window.SHOP = {
  name: "새로고침",
  tagline: "데코타일 미리보기"
};
