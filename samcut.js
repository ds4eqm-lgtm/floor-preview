/* 물건 테두리로 바닥 다시 오리기 (Segment Anything 작은 모델 SlimSAM)
   첫 번째 AI(바닥 찾기)가 놓치거나 더 넣은 곳을 물건 테두리를 따라 고침
   방법
   1 바닥 한가운데 몇 곳은 바닥이라고(+), 바닥에서 조금 떨어진 벽, 문 쪽 몇 곳은 바닥이 아니라고(-) SAM 에 알려줌
     (바닥과 같은 재질로 보이는 곳에는 - 점을 안 찍음: 첫 번째 AI 가 놓친 바닥일 수 있어서)
   2 SAM 이 물건 테두리를 따라 오린 바닥 모양 몇 가지를 받음
   3 빼기: 첫 번째 AI 는 바닥, SAM 은 아님 → 바닥 가장자리에 붙고 두께 있는 덩어리만 뺌 (문 아래, 가구 다리)
   4 채우기: SAM 은 바닥, 첫 번째 AI 는 아님, 색도 바닥과 같은 재질 → 바닥에 붙어 있고 얕은 덩어리만 채움 (문턱 앞, 가구 사이)
      벽처럼 바닥에서 위로 길게 뻗는 덩어리는 안 채움
   5 흐릿한 경계는 SAM 테두리 쪽으로 또렷하게
   바닥 한가운데 떠 있는 조각(페인트 자국, 그림자)과 경계를 따라 가늘게 깎이는 부분은 그대로 둠
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
    /* 사진 색 (작은 칸) 과 바닥 색 분포: 바닥과 같은 재질인지 보는 데 씀 */
    const pc=document.createElement("canvas");pc.width=w;pc.height=h;
    const px=pc.getContext("2d",{willReadFrequently:true});px.drawImage(photo,0,0,w,h);
    const pd=px.getImageData(0,0,w,h).data,cr=new Float32Array(n),cg=new Float32Array(n),lum=new Float32Array(n);
    for(let i=0;i<n;i++){const r=pd[i*4]+1,g=pd[i*4+1]+1,b=pd[i*4+2]+1,t=r+g+b;cr[i]=r/t;cg[i]=g/t;lum[i]=Math.log(t);}
    /* 점 고르기 (작은 칸 기준) */
    const Din=distIn(ai,w,h,true),out=new Uint8Array(n);for(let i=0;i<n;i++)out[i]=ai[i]?0:1;
    const Dout=distIn(out,w,h),S=Math.max(w,h);
    let maxIn=0;for(let i=0;i<n;i++)if(Din[i]>maxIn)maxIn=Din[i];
    /* 바닥 안쪽 색 평균과 퍼짐 */
    let m1=0,m2=0,ml=0,cnt=0;const core=Math.max(2,maxIn*.2);
    for(let i=0;i<n;i++)if(Din[i]>=core){m1+=cr[i];m2+=cg[i];ml+=lum[i];cnt++;}
    m1/=cnt||1;m2/=cnt||1;ml/=cnt||1;
    let v1=0,v2=0,vl=0;for(let i=0;i<n;i++)if(Din[i]>=core){v1+=(cr[i]-m1)**2;v2+=(cg[i]-m2)**2;vl+=(lum[i]-ml)**2;}
    const s1=Math.max(.006,Math.sqrt(v1/(cnt||1))),s2=Math.max(.006,Math.sqrt(v2/(cnt||1))),sl=Math.max(.15,Math.sqrt(vl/(cnt||1)));
    /* 바닥과 같은 재질처럼 보이는지 (색 비율은 엄격하게, 밝기는 그림자 때문에 느슨하게) */
    const floorLike=i=>((cr[i]-m1)/s1)**2+((cg[i]-m2)/s2)**2<9&&Math.abs(lum[i]-ml)<Math.max(.7,sl*3);
    const pos=pickSpread(Din,w,h,8,S*.12,Math.max(2,maxIn*.35));
    /* 바닥 아님 점: 바닥 바깥 띠에서, 바닥과 같은 재질로 보이는 곳(첫 번째 AI가 놓친 바닥일 수 있음)은 빼고 */
    const Dneg=Float32Array.from(Dout);for(let i=0;i<n;i++)if(floorLike(i))Dneg[i]=0;
    const neg=pickRing(Dneg,w,h,10,S*.07,S*.2,S*.1);
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
      if(neg.length)cands.push(...await runPts([...pos,...neg],[...pos.map(()=>1),...neg.map(()=>0)]));
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
    for(const c of cands){let a=0,inn=0;for(let i=0;i<n;i++){if(c.m[i]>.5){a++;if(ai[i])inn++;}}c.rec=inn/aiArea;c.size=a/aiArea;}
    const candInfo=cands.map(c=>c.iou.toFixed(2)+"/"+c.score.toFixed(2)+"/"+c.rec.toFixed(2)+"/"+c.size.toFixed(2)).join(" ");
    /* 채우기용: 첫 번째 AI 바닥을 거의 다 덮으면서(95퍼센트 이상) 조금 더 넓게 본 것 중 가장 넓은 것 (놓친 바닥까지 본 SAM 답) */
    let wide=best;
    for(const c of cands)if(c.rec>=.95&&c.score>=.9&&c.size<=1.35&&c.size>wide.size)wide=c;
    const sam=best.m;
    const r0=Math.max(2,S*.005),minA=n*.0006,minT=Math.max(6,S*.012);
    /* 덩어리 찾기: 들쭉날쭉한 가장자리를 털어내고(깎았다 다시 불리기), 바닥 경계에 맞닿고 두께 있는 덩어리만 */
    const pieces=(diff,touchD,maxArea,maxDepth)=>{
      const D0=distIn(diff,w,h,false),ne=new Uint8Array(n);
      for(let i=0;i<n;i++)ne[i]=D0[i]>r0?0:1;
      const Dn=distIn(ne,w,h,false);
      for(let i=0;i<n;i++)diff[i]=diff[i]&&Dn[i]<=r0+.5?1:0;
      const Dd=distIn(diff,w,h,false);
      const lab=new Int32Array(n).fill(-1),q=new Int32Array(n),keep=new Uint8Array(n);let area=0,cnt=0;
      for(let i=0;i<n;i++){
        if(!diff[i]||lab[i]>=0)continue;
        const id=i;let qh=0,qt=0,a=0,edge=0,thick=0,deep=0;q[qt++]=i;lab[i]=id;
        while(qh<qt){const j=q[qh++];a++;if(Dd[j]>thick)thick=Dd[j];const x=j%w,y=(j/w)|0;
          for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;
            if(xx<0||yy<0||xx>=w||yy>=h)continue;const k=yy*w+xx;
            if(diff[k]&&lab[k]<0){lab[k]=id;q[qt++]=k;}}
          if(touchD[j]<=r0+1.5)edge++;if(touchD[j]>deep)deep=touchD[j];}
        if(edge>=3&&a>=minA&&thick>=minT&&a<maxArea&&deep<=maxDepth){for(let t=0;t<qt;t++)keep[q[t]]=1;area+=a;cnt++;}
      }
      return {keep,area,cnt};
    };
    const feather=m=>{const b=new Float32Array(n);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0,c=0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;s+=m[yy*w+xx];c++;}
        b[y*w+x]=Math.max(m[y*w+x],Math.min(1,s/c*1.2));}
      return b;};
    /* 1 빼기: 첫 번째 AI 는 바닥, SAM 은 아님 (문 아래, 가구 다리) */
    const dCut=new Uint8Array(n);for(let i=0;i<n;i++)dCut[i]=ai[i]&&sam[i]<.35?1:0;
    const Dai=distIn(ai,w,h,false);
    const C=pieces(dCut,Dai,aiArea*.25,Infinity);
    /* 2 채우기: SAM 은 바닥, 첫 번째 AI 는 아님, 색도 바닥과 같은 재질 (문턱 앞, 가구 사이에서 놓친 바닥) */
    /* 다듬기 단계에서 일부러 뺀 곳(걸레받이, 검은 다리)은 다시 채우지 않음 (o.block, 둘레 2칸까지) */
    let blk=null;
    if(o.block){blk=Uint8Array.from(o.block);for(let k=0;k<2;k++){const b2=Uint8Array.from(blk);for(let i=0;i<n;i++)if(!blk[i]){const x=i%w;if((x>0&&blk[i-1])||(x<w-1&&blk[i+1])||(i>=w&&blk[i-w])||(i<n-w&&blk[i+w]))b2[i]=1;}blk=b2;}}
    const samW=wide.m,dAdd=new Uint8Array(n);for(let i=0;i<n;i++)dAdd[i]=!ai[i]&&samW[i]>.65&&floorLike(i)&&!(blk&&blk[i])?1:0;
    /* 바닥에서 너무 멀리 뻗는 조각(벽처럼 위로 길게 이어진 것)은 안 채움: 문턱 앞, 가구 사이처럼 얕은 곳만 */
    const A=pieces(dAdd,Dout,aiArea*.2,S*.1);
    const outSoft=Float32Array.from(soft);
    if(C.cnt){const f=feather(C.keep);for(let i=0;i<n;i++)outSoft[i]=Math.min(outSoft[i],1-f[i]);}
    if(A.cnt){const f=feather(A.keep);for(let i=0;i<n;i++)outSoft[i]=Math.max(outSoft[i],f[i]);}
    /* 3 경계 또렷하게: 두 AI 가 거의 같게 본 곳에서 흐릿한 경계(0.15~0.85)는 SAM 테두리 쪽으로 */
    let sharp=0;
    if(best.iou>=.8)for(let i=0;i<n;i++){const v=outSoft[i];if(v>.15&&v<.85&&!C.keep[i]&&!A.keep[i]&&!(blk&&blk[i])){const t=sam[i]>.5?Math.max(v,.5+.5*sam[i]):Math.min(v,.5*sam[i]);outSoft[i]=v*.35+t*.65;sharp++;}}
    const t3=performance.now();
    return {soft:outSoft,iou:best.iou,pos,neg,sam:samW,
      cands:candInfo,info:"SAM iou "+best.iou.toFixed(2)+" 뺀 조각 "+C.cnt+"("+(C.area/aiArea*100).toFixed(1)+"%) 채운 조각 "+A.cnt+"("+(A.area/aiArea*100).toFixed(1)+"%) 또렷 "+sharp+" 준비 "+Math.round(t1-t0)+"ms 읽기 "+Math.round(t2-t1)+"ms 오리기 "+Math.round(t3-t2)+"ms"};
  }
  window.FloorSAM={refine,ensureSam};
})();
