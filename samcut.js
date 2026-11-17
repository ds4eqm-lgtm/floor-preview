/* 물건 테두리로 바닥 다시 오리기 (Segment Anything 작은 모델 SlimSAM)
   첫 번째 AI(바닥 찾기)가 문 아래, 가구 다리처럼 바닥과 색이 비슷한 물건까지 바닥에 넣는 걸 막음
   방법
   1 바닥 한가운데 몇 곳은 바닥이라고(+), 바닥 바깥 경계 근처 몇 곳은 바닥이 아니라고(-) SAM 에 알려줌
   2 SAM 이 물건 테두리를 따라 오린 바닥 모양을 받음
   3 첫 번째 AI 는 바닥이라는데 SAM 은 아니라는 부분 중에서, 바닥 가장자리에 붙어 있는 조각만 뺌
      (바닥 한가운데 페인트 자국이나 그림자처럼 안쪽에 떠 있는 조각은 그대로 둠)
   모델 파일은 models/slimsam 에 같이 올려둠 (처음 한 번만 받고 브라우저에 저장) */
(function(){
  let samP=null;
  function ensureSam(tf,base,onProgress){
    if(samP)return samP;
    samP=(async()=>{
      tf.env.allowLocalModels=true;
      tf.env.localModelPath=base;
      const files={};
      const cb=e=>{if(!onProgress||!e||e.status!=="progress"||!e.total)return;files[e.file]=[e.loaded,e.total];
        let a=0,b=0;for(const k in files){a+=files[k][0];b+=files[k][1];}onProgress(a/b);};
      const [model,processor]=await Promise.all([
        tf.SamModel.from_pretrained("slimsam",{dtype:"q8",device:"wasm",local_files_only:true,progress_callback:cb}),
        tf.AutoProcessor.from_pretrained("slimsam",{local_files_only:true})
      ]);
      /* 바닥 찾는 AI 는 원래대로 인터넷에서만 받게 되돌림 */
      tf.env.allowLocalModels=false;
      return {model,processor};
    })();
    samP.catch(()=>{samP=null;});
    return samP;
  }
  /* 바닥 안쪽 거리 (체스판 거리, 두 번 훑기) */
  function distIn(bin,w,h,edge){
    const D=new Float32Array(w*h),INF=1e9;
    for(let i=0;i<w*h;i++)D[i]=bin[i]?INF:0;
    /* 사진 가장자리도 경계로 봄 (점이 사진 끝에 몰리지 않게) */
    if(edge)for(let i=0;i<w*h;i++){const x=i%w,y=(i/w)|0;if(D[i]&&(x===0||y===0||x===w-1||y===h-1))D[i]=1;}
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!D[i])continue;
      let v=D[i];if(x>0)v=Math.min(v,D[i-1]+1);if(y>0){v=Math.min(v,D[i-w]+1);if(x>0)v=Math.min(v,D[i-w-1]+1.414);if(x<w-1)v=Math.min(v,D[i-w+1]+1.414);}D[i]=v;}
    for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const i=y*w+x;if(!D[i])continue;
      let v=D[i];if(x<w-1)v=Math.min(v,D[i+1]+1);if(y<h-1){v=Math.min(v,D[i+w]+1);if(x<w-1)v=Math.min(v,D[i+w+1]+1.414);if(x>0)v=Math.min(v,D[i+w-1]+1.414);}D[i]=v;}
    for(let i=0;i<w*h;i++)if(D[i]>=INF)D[i]=Math.max(w,h);
    return D;
  }
  /* 거리값 큰 곳부터, 서로 떨어진 점 n 개 */
  function pickSpread(D,w,h,n,minGap,minVal){
    const idx=[];for(let i=0;i<w*h;i++)if(D[i]>=minVal)idx.push(i);
    idx.sort((a,b)=>D[b]-D[a]);
    const out=[];
    for(const i of idx){
      const x=i%w,y=(i/w)|0;
      if(out.every(p=>Math.hypot(p[0]-x,p[1]-y)>=minGap))out.push([x,y]);
      if(out.length>=n)break;
    }
    return out;
  }
  /* 바닥 바깥, 경계에서 조금 떨어진 띠에서 고르게 n 개 */
  function pickRing(Dout,w,h,n,lo,hi,minGap){
    const cand=[];for(let i=0;i<w*h;i++)if(Dout[i]>=lo&&Dout[i]<=hi)cand.push(i);
    const out=[];
    if(!cand.length)return out;
    /* 무작위 대신 고정 순서로 섞어서 매번 같은 결과 */
    let seed=12345;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
    for(let k=0;k<cand.length*2&&out.length<n;k++){
      const i=cand[Math.floor(rnd()*cand.length)],x=i%w,y=(i/w)|0;
      if(out.every(p=>Math.hypot(p[0]-x,p[1]-y)>=minGap))out.push([x,y]);
    }
    return out;
  }
  /* 큰 마스크(원본 크기, 0/1)를 작은 칸으로 줄여 비율로 */
  function shrinkMask(data,W,H,w,h){
    const out=new Float32Array(w*h),sx=W/w,sy=H/h;
    for(let y=0;y<h;y++){const y0=Math.floor(y*sy),y1=Math.max(y0+1,Math.floor((y+1)*sy));
      for(let x=0;x<w;x++){const x0=Math.floor(x*sx),x1=Math.max(x0+1,Math.floor((x+1)*sx));
        let s=0,c=0;for(let yy=y0;yy<y1;yy+=2)for(let xx=x0;xx<x1;xx+=2){s+=data[yy*W+xx]?1:0;c++;}
        out[y*w+x]=c?s/c:0;}}
    return out;
  }
  async function refine(o){
    const t0=performance.now();
    const {tf,photo,soft,w,h,base}=o;
    const n=w*h,ai=new Uint8Array(n);let aiArea=0;
    for(let i=0;i<n;i++){ai[i]=soft[i]>.5?1:0;aiArea+=ai[i];}
    if(aiArea<n*.03)return {soft,info:"SAM 건너뜀(바닥 작음)"};
    const {model,processor}=await ensureSam(tf,base,o.onProgress);
    const t1=performance.now();
    const image=await tf.RawImage.fromCanvas(photo);
    const inputs=await processor(image);
    const emb=await model.get_image_embeddings(inputs);
    const t2=performance.now();
    /* 점 고르기 (작은 칸 기준) */
    const Din=distIn(ai,w,h,true),out=new Uint8Array(n);for(let i=0;i<n;i++)out[i]=ai[i]?0:1;
    const Dout=distIn(out,w,h),S=Math.max(w,h);
    let maxIn=0;for(let i=0;i<n;i++)if(Din[i]>maxIn)maxIn=Din[i];
    const pos=pickSpread(Din,w,h,8,S*.12,Math.max(2,maxIn*.35));
    const neg=pickRing(Dout,w,h,10,S*.02,S*.06,S*.1);
    const [rh,rw]=inputs.reshaped_input_sizes[0];
    const toR=p=>[(p[0]+.5)/w*rw,(p[1]+.5)/h*rh];
    const runPts=async(pts,lab)=>{
      const ip=new tf.Tensor("float32",Float32Array.from(pts.flatMap(toR)),[1,1,pts.length,2]);
      const il=new tf.Tensor("int64",BigInt64Array.from(lab.map(v=>BigInt(v))),[1,1,lab.length]);
      const r=await model({...emb,input_points:ip,input_labels:il});
      const ms=await processor.post_process_masks(r.pred_masks,inputs.original_sizes,inputs.reshaped_input_sizes);
      const m=ms[0],[,,MH,MW]=m.dims,sc=r.iou_scores.data,res=[];
      for(let k=0;k<m.dims[1];k++){
        const sub=m.data.subarray(k*MH*MW,(k+1)*MH*MW);
        res.push({m:shrinkMask(sub,MW,MH,w,h),score:sc[k]});
      }
      return res;
    };
    const cands=[];
    if(pos.length){
      cands.push(...await runPts([...pos,...neg],[...pos.map(()=>1),...neg.map(()=>0)]));
      cands.push(...await runPts(pos,pos.map(()=>1)));
    }
    if(!cands.length)return {soft,info:"SAM 점 없음"};
    /* 첫 번째 AI 바닥과 가장 잘 겹치는 것 */
    let best=null;
    for(const c of cands){
      let inter=0,uni=0;for(let i=0;i<n;i++){const s=c.m[i]>.5;inter+=s&&ai[i]?1:0;uni+=s||ai[i]?1:0;}
      c.iou=uni?inter/uni:0;c.val=c.iou*(.5+.5*c.score);
      if(!best||c.val>best.val)best=c;
    }
    if(best.iou<.6)return {soft,info:"SAM 안 맞음 iou "+best.iou.toFixed(2)};
    /* 첫 번째 AI 는 바닥, SAM 은 아님 → 조각 나누기 */
    const sam=best.m,diff=new Uint8Array(n);
    for(let i=0;i<n;i++)diff[i]=ai[i]&&sam[i]<.35?1:0;
    /* 들쭉날쭉한 가장자리 털어내기 (깎았다 다시 불리기): 덩어리진 조각만 남김 */
    const r0=Math.max(2,S*.005),D0=distIn(diff,w,h,false),ne=new Uint8Array(n);
    for(let i=0;i<n;i++)ne[i]=D0[i]>r0?0:1;
    const Dn=distIn(ne,w,h,false);
    for(let i=0;i<n;i++)diff[i]=diff[i]&&Dn[i]<=r0+.5?1:0;
    const Dd=distIn(diff,w,h,false),Dai=distIn(ai,w,h,false);
    const lab=new Int32Array(n).fill(-1),comps=[],q=new Int32Array(n);
    for(let i=0;i<n;i++){
      if(!diff[i]||lab[i]>=0)continue;
      const id=comps.length;let qh=0,qt=0,area=0,edge=0,thick=0;q[qt++]=i;lab[i]=id;
      while(qh<qt){const j=q[qh++];area++;if(Dd[j]>thick)thick=Dd[j];const x=j%w,y=(j/w)|0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;
          if(xx<0||yy<0||xx>=w||yy>=h)continue;const k=yy*w+xx;
          if(diff[k]&&lab[k]<0){lab[k]=id;q[qt++]=k;}}
        if(Dai[j]<=r0+1.5)edge++;}
      comps.push({area,edge,thick});
    }
    const cut=new Uint8Array(comps.length);let cutArea=0,nCut=0;
    const minA=n*.0006,minT=Math.max(6,S*.012);
    for(let c=0;c<comps.length;c++){
      const C=comps[c];
      /* 바닥 가장자리(바닥 아닌 곳)에 맞닿고, 두께가 있고(경계 따라 가늘게 깎이는 건 무시), 너무 크지 않은 조각만 */
      if(C.edge>=3&&C.area>=minA&&C.thick>=minT&&C.area<aiArea*.25){cut[c]=1;cutArea+=C.area;nCut++;}
    }
    const outSoft=Float32Array.from(soft);
    if(nCut){
      const rm=new Float32Array(n);for(let i=0;i<n;i++)if(lab[i]>=0&&cut[lab[i]])rm[i]=1;
      /* 경계 살짝 부드럽게 */
      const b=new Float32Array(n);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0,c=0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;s+=rm[yy*w+xx];c++;}
        b[y*w+x]=s/c;}
      for(let i=0;i<n;i++)outSoft[i]=Math.min(outSoft[i],1-Math.min(1,Math.max(rm[i],b[i]*1.2)));
    }
    const t3=performance.now();
    return {soft:outSoft,cutArea:cutArea/aiArea,nCut,iou:best.iou,pos,neg,sam,
      info:"SAM iou "+best.iou.toFixed(2)+" 뺀 조각 "+nCut+"("+(cutArea/aiArea*100).toFixed(1)+"%) 준비 "+Math.round(t1-t0)+"ms 읽기 "+Math.round(t2-t1)+"ms 오리기 "+Math.round(t3-t2)+"ms"};
  }
  window.FloorSAM={refine,ensureSam};
})();
